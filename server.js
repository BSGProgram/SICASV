const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto'); // Para gerar senhas aleatórias
const path = require('path');
const nodemailer = require('nodemailer');
const fs = require('fs');
const archiver = require('archiver');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'frontend')));

// Configuração inicial para conectar ao MySQL (sem especificar o banco ainda)
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD, // Lê do .env
    multipleStatements: true
};

const dbName = process.env.DB_NAME || 'sicasv';
let db; // Conexão global

// Configuração do Nodemailer (Envio de Emails Reais)
// Lógica automática para definir Host/Porta baseada no email, se não estiver no .env
const emailUser = process.env.EMAIL_USER || '';
let emailHost = process.env.EMAIL_HOST;
let emailPort = process.env.EMAIL_PORT;
let emailSecure = false;

if (!emailHost && emailUser) {
    const domain = emailUser.split('@')[1]?.toLowerCase();
    if (domain) {
        if (domain.includes('hotmail') || domain.includes('outlook') || domain.includes('live')) {
            emailHost = 'smtp.office365.com';
            emailPort = 587;
            emailSecure = false; // STARTTLS
        } else if (domain.includes('yahoo')) {
            emailHost = 'smtp.mail.yahoo.com';
            emailPort = 465;
            emailSecure = true; // SSL
        }
    }
}

const transporter = nodemailer.createTransport({
    host: emailHost || 'smtp.gmail.com', 
    port: emailPort || 587,
    secure: emailSecure, // true para porta 465, false para outras (587)
    auth: {
        user: emailUser,
        pass: process.env.EMAIL_PASS  // Sua senha de app (não a senha normal)
    }
});

if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn("\n⚠️  AVISO: Credenciais de email (EMAIL_USER/EMAIL_PASS) não encontradas no arquivo .env.\n   O sistema de recuperação de senha não enviará emails reais.\n");
}

// Função para registrar logs de email em arquivo de texto
function logEmail(status, to, subject, error = null) {
    const timestamp = new Date().toLocaleString('pt-BR');
    const msg = `[${timestamp}] STATUS: ${status} | PARA: ${to} | ASSUNTO: ${subject} ${error ? '| ERRO: ' + error : ''}\n`;
    fs.appendFile(path.join(__dirname, 'email_logs.txt'), msg, (err) => {
        if (err) console.error('Erro ao gravar log de email:', err);
    });
}

function inicializarSistema() {
    console.log('🔄 Tentando conectar ao MySQL...');

    // Cria uma conexão temporária para verificar/criar o banco
    const connection = mysql.createConnection(dbConfig);

    connection.connect((err) => {
        if (err) {
            console.error('\n❌ ERRO DE CONEXÃO COM O MYSQL:');
            console.error(`   Código: ${err.code}`);
            console.error(`   Mensagem: ${err.message}`);
            
            if (err.code === 'ER_ACCESS_DENIED_ERROR') {
                console.error('\n⚠️  PROBLEMA DE SENHA DETECTADO:');
                console.error('   O MySQL recusou a conexão. Isso geralmente acontece porque:');
                console.error('   1. Você tem uma senha configurada no MySQL, mas não colocou no arquivo .env');
                console.error('   2. Ou a senha no arquivo .env está incorreta.');
                console.error('\n👉 SOLUÇÃO: Abra o arquivo .env e coloque a senha correta em DB_PASSWORD.');
            }
            return;
        }

        console.log('✅ Conectado ao MySQL com sucesso.');

        // 1. Cria o banco de dados se não existir
        connection.query(`CREATE DATABASE IF NOT EXISTS ${dbName}`, (err) => {
            if (err) {
                console.error('❌ Erro ao criar banco de dados:', err);
                connection.end();
                return;
            }
            console.log(`✅ Banco de dados '${dbName}' verificado/criado.`);
            
            // Fecha a conexão temporária
            connection.end();

            // 2. Inicia a conexão definitiva com o banco selecionado
            conectarAoBancoDefinitivo();
        });
    });
}

function conectarAoBancoDefinitivo() {
    db = mysql.createPool({
        ...dbConfig,
        database: dbName
    });

    // Cria as tabelas
    const sqlTabelas = `
        CREATE TABLE IF NOT EXISTS administradores (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(100),
            cpf VARCHAR(14),
            telefone VARCHAR(20),
            email VARCHAR(255) UNIQUE NOT NULL,
            senha VARCHAR(255) NOT NULL,
            role ENUM('master', 'admin') DEFAULT 'admin',
            primeiro_acesso TINYINT(1) DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS titulares (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(255) NOT NULL,
            cpf VARCHAR(14) NOT NULL UNIQUE,
            rg VARCHAR(20),
            dataEmissaoRg DATE,
            orgaoEmissorRg VARCHAR(20),
            numCtps VARCHAR(20),
            serieCtps VARCHAR(20),
            ufCtps VARCHAR(2),
            dataEmissaoCtps DATE,
            numTitulo VARCHAR(20),
            zonaTitulo VARCHAR(10),
            secaoTitulo VARCHAR(10),
            cidadeUfTitulo VARCHAR(50),
            numPis VARCHAR(20),
            dataEmissaoPis DATE,
            cnh VARCHAR(20),
            registroProfissional VARCHAR(50),
            dataNasc DATE,
            sexo VARCHAR(20),
            raca VARCHAR(20),
            estadoCivil VARCHAR(20),
            nacionalidade VARCHAR(50),
            naturalidade VARCHAR(50),
            grauInstrucao VARCHAR(50),
            nomePai VARCHAR(100),
            nomeMae VARCHAR(100),
            email VARCHAR(100),
            telefone VARCHAR(20),
            celular VARCHAR(20),
            cep VARCHAR(10),
            endereco VARCHAR(255),
            numero VARCHAR(10),
            bairro VARCHAR(50),
            cidade VARCHAR(50),
            uf VARCHAR(2),
            matricula VARCHAR(20),
            tipoAdmissao VARCHAR(50),
            dataAdmissao DATE,
            numPortaria VARCHAR(20),
            tipoCargo VARCHAR(50),
            cargo VARCHAR(100),
            regimeTrabalho VARCHAR(50),
            salarioBase DECIMAL(10,2),
            secretaria VARCHAR(100),
            setor VARCHAR(100),
            unidadeTrabalho VARCHAR(100),
            lotacao VARCHAR(100),
            deleted_at DATETIME DEFAULT NULL,
            status ENUM('rascunho', 'finalizado') DEFAULT 'finalizado',
            foto_perfil LONGTEXT
        );

        CREATE TABLE IF NOT EXISTS conjuges (
            id INT AUTO_INCREMENT PRIMARY KEY,
            titular_id INT NOT NULL,
            nome VARCHAR(100),
            cpf VARCHAR(14),
            dataNasc DATE,
            FOREIGN KEY (titular_id) REFERENCES titulares(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS dependentes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            titular_id INT NOT NULL,
            nome VARCHAR(100),
            cpf VARCHAR(14),
            parentesco VARCHAR(50),
            dataNasc DATE,
            FOREIGN KEY (titular_id) REFERENCES titulares(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS anexos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            titular_id INT NOT NULL,
            nome_arquivo VARCHAR(255),
            tipo_arquivo VARCHAR(100),
            conteudo LONGTEXT,
            FOREIGN KEY (titular_id) REFERENCES titulares(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            admin_id INT,
            acao VARCHAR(50),
            alvo_id INT,
            detalhes TEXT,
            data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;

    db.query(sqlTabelas, (err) => {
        if (err) {
            console.error('❌ Erro ao criar tabelas:', err);
            return;
        }
        console.log('✅ Tabelas verificadas/criadas.');

        // Migrações para bancos existentes
        db.query("ALTER TABLE titulares ADD COLUMN deleted_at DATETIME DEFAULT NULL", (err) => {
            if (err && err.code !== 'ER_DUP_FIELDNAME') console.error('Erro migration deleted_at:', err);

            db.query("ALTER TABLE titulares ADD COLUMN foto_perfil LONGTEXT", (errFoto) => {
                if (errFoto && errFoto.code !== 'ER_DUP_FIELDNAME') console.error('Erro migration foto_perfil:', errFoto);

            db.query("ALTER TABLE titulares ADD COLUMN status ENUM('rascunho', 'finalizado') DEFAULT 'finalizado'", (errStatus) => {
                if (errStatus && errStatus.code !== 'ER_DUP_FIELDNAME') console.error('Erro migration status:', errStatus);

            // Migração para Esqueci Minha Senha
            db.query("ALTER TABLE administradores ADD COLUMN reset_token VARCHAR(255) DEFAULT NULL", (errToken) => {
                if (errToken && errToken.code !== 'ER_DUP_FIELDNAME') console.error('Erro migration reset_token:', errToken);
            
            db.query("ALTER TABLE administradores ADD COLUMN reset_expires DATETIME DEFAULT NULL", (errExpires) => {
                if (errExpires && errExpires.code !== 'ER_DUP_FIELDNAME') console.error('Erro migration reset_expires:', errExpires);

            // Garante a criação do índice UNIQUE para bancos já existentes (migração)
            db.query("ALTER TABLE titulares ADD UNIQUE INDEX idx_cpf_unique (cpf)", (errIndex) => {
                if (errIndex && errIndex.code === 'ER_DUP_ENTRY') {
                    console.warn('⚠️ AVISO: CPFs duplicados encontrados no banco. O índice UNIQUE não pôde ser aplicado.');
                }

                // Cria usuário Master padrão
                const sqlMaster = "INSERT IGNORE INTO administradores (email, senha, role, primeiro_acesso) VALUES ('admin@sicasv.com', 'master123', 'master', 0)";
                db.query(sqlMaster, (err) => {
                    if (!err) console.log("✅ Usuário Master pronto: admin@sicasv.com / master123");
                    iniciarServidor();
                });
            });
            });
            });
            });
            });
        });
    });
}

function registrarAuditoria(adminId, acao, alvoId, detalhes) {
    const sql = 'INSERT INTO audit_logs (admin_id, acao, alvo_id, detalhes) VALUES (?, ?, ?, ?)';
    db.query(sql, [adminId || null, acao, alvoId, detalhes], (err) => {
        if (err) console.error('Erro ao registrar auditoria:', err);
    });
}

function iniciarServidor() {
    // Endpoints
    app.get('/api/servidores', async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const search = req.query.search || '';
            const cargo = req.query.cargo || '';
            const secretaria = req.query.secretaria || '';
            const tipoAdmissao = req.query.tipoAdmissao || '';
            const status = req.query.status || 'finalizado'; // Padrão: finalizado
            const sortBy = req.query.sortBy || 'nome';
            const order = req.query.order || 'ASC';
            const offset = (page - 1) * limit;

            let query = 'SELECT id, matricula, nome, cpf, cargo, lotacao, status FROM titulares';
            let countQuery = 'SELECT COUNT(*) as total FROM titulares';
            let params = [];
            let conditions = [];

            if (search) {
                conditions.push('(nome LIKE ? OR cpf LIKE ? OR matricula LIKE ?)');
                const searchTerm = `%${search}%`;
                params.push(searchTerm, searchTerm, searchTerm);
            }

            if (cargo) {
                conditions.push('cargo LIKE ?');
                params.push(`%${cargo}%`);
            }
            if (secretaria) {
                conditions.push('secretaria LIKE ?');
                params.push(`%${secretaria}%`);
            }
            if (tipoAdmissao) {
                conditions.push('tipoAdmissao = ?');
                params.push(tipoAdmissao);
            }
            
            if (status) {
                conditions.push('status = ?');
                params.push(status);
            }

            // Filtra apenas os não excluídos (Soft Delete)
            conditions.push('deleted_at IS NULL');

            if (conditions.length > 0) {
                const whereClause = ' WHERE ' + conditions.join(' AND ');
                query += whereClause;
                countQuery += whereClause;
            }

            // Validação de segurança para ordenação
            const validSorts = ['nome', 'matricula', 'cargo'];
            const sortField = validSorts.includes(sortBy) ? sortBy : 'nome';
            const sortOrder = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
            
            query += ` ORDER BY ${sortField} ${sortOrder}`;
            
            // Se limit for maior que 0, aplica paginação. Se for -1 (exportação), pega tudo.
            if (limit > 0) {
                query += ' LIMIT ? OFFSET ?';
            }

            // 1. Conta o total de registros (para a paginação)
            const [countResult] = await db.promise().query(countQuery, params);
            const total = countResult[0].total;

            // 2. Busca os dados paginados
            const queryParams = limit > 0 ? [...params, limit, offset] : params;
            const [titulares] = await db.promise().query(query, queryParams);

            res.json({ data: titulares, total, page, limit });
        } catch (error) {
            res.status(500).json({ error: 'Erro ao buscar dados: ' + error.message });
        }
    });

    // Endpoint para servir a foto de perfil (Cacheada pelo navegador)
    app.get('/api/servidor/:id/foto', async (req, res) => {
        const { id } = req.params;
        try {
            const [rows] = await db.promise().query('SELECT foto_perfil FROM titulares WHERE id = ?', [id]);
            
            if (rows.length === 0 || !rows[0].foto_perfil) return res.status(404).send('Sem foto');

            const matches = rows[0].foto_perfil.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) return res.status(404).send('Formato inválido');

            const imgBuffer = Buffer.from(matches[2], 'base64');
            res.writeHead(200, {
                'Content-Type': matches[1],
                'Content-Length': imgBuffer.length,
                'Cache-Control': 'public, max-age=86400' // Cache de 1 dia
            });
            res.end(imgBuffer);
        } catch (e) {
            res.status(500).send('Erro ao buscar foto');
        }
    });

    // Endpoint para buscar um servidor completo pelo ID
    app.get('/api/servidor/:id', async (req, res) => {
        const { id } = req.params;
        const isEdit = req.query.edit === 'true';

        try {
            const [rows] = await db.promise().query('SELECT * FROM titulares WHERE id = ? AND deleted_at IS NULL', [id]);
            
            if (rows.length === 0) {
                return res.status(404).json({ error: 'Nenhum cadastro encontrado para este ID.' });
            }

            const titular = rows[0];

            Object.keys(titular).forEach(key => {
                if (titular[key] instanceof Date) {
                    titular[key] = titular[key].toISOString().split('T')[0];
                }
            });

            const [conjuges] = await db.promise().query('SELECT * FROM conjuges WHERE titular_id = ?', [titular.id]);
            const [dependentes] = await db.promise().query('SELECT * FROM dependentes WHERE titular_id = ?', [titular.id]);
            
            let queryAnexos = 'SELECT id, nome_arquivo, tipo_arquivo';
            if (isEdit) queryAnexos += ', conteudo';
            queryAnexos += ' FROM anexos WHERE titular_id = ?';
            const [anexos] = await db.promise().query(queryAnexos, [titular.id]);

            const conjuge = conjuges.length > 0 ? conjuges[0] : null;
            
            const responseData = {
                ...titular,
                conjuge: {
                    temConjuge: !!conjuge,
                    nome: conjuge?.nome || '',
                    cpf: conjuge?.cpf || '',
                    dataNasc: conjuge?.dataNasc ? conjuge.dataNasc.toISOString().split('T')[0] : ''
                },
                dependentes: dependentes.map(d => ({ ...d, dataNasc: d.dataNasc ? d.dataNasc.toISOString().split('T')[0] : '' })),
                anexos: anexos.map(a => ({ id: a.id, nome: a.nome_arquivo, tipo: a.tipo_arquivo, conteudo: a.conteudo }))
            };

            res.json(responseData);
        } catch (error) {
            console.error('Erro ao buscar cadastro por ID:', error);
            res.status(500).json({ error: 'Erro interno ao buscar dados.' });
        }
    });

    // Endpoint para buscar conteúdo de um anexo específico (Lazy Loading)
    app.get('/api/anexo/:id', async (req, res) => {
        const { id } = req.params;
        try {
            const [rows] = await db.promise().query('SELECT conteudo, tipo_arquivo, nome_arquivo FROM anexos WHERE id = ?', [id]);
            if (rows.length === 0) return res.status(404).json({ error: 'Anexo não encontrado' });
            res.json({ conteudo: rows[0].conteudo, tipo: rows[0].tipo_arquivo, nome: rows[0].nome_arquivo });
        } catch (e) {
            res.status(500).json({ error: 'Erro ao buscar anexo' });
        }
    });

    // Endpoint para download direto de anexo
    app.get('/api/anexo/:id/download', async (req, res) => {
        const { id } = req.params;
        try {
            const [rows] = await db.promise().query('SELECT conteudo, tipo_arquivo, nome_arquivo FROM anexos WHERE id = ?', [id]);
            if (rows.length === 0) return res.status(404).send('Anexo não encontrado');
            
            const file = rows[0];
            // Remove o prefixo do Data URI (ex: data:image/png;base64,)
            const matches = file.conteudo.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            
            if (!matches || matches.length !== 3) {
                const buffer = Buffer.from(file.conteudo, 'base64'); // Tenta direto se não tiver prefixo
                res.setHeader('Content-Disposition', `attachment; filename="${file.nome_arquivo}"`);
                res.send(buffer);
                return;
            }
            
            const buffer = Buffer.from(matches[2], 'base64');
            res.setHeader('Content-Disposition', `attachment; filename="${file.nome_arquivo}"`);
            res.setHeader('Content-Type', file.tipo_arquivo);
            res.send(buffer);
        } catch (e) {
            console.error(e);
            res.status(500).send('Erro ao baixar anexo');
        }
    });

    // Endpoint para baixar todos os anexos de um servidor em ZIP
    app.get('/api/servidor/:id/anexos/zip', async (req, res) => {
        const { id } = req.params;
        try {
            // Busca nome do servidor para o arquivo
            const [servidor] = await db.promise().query('SELECT nome FROM titulares WHERE id = ?', [id]);
            if (servidor.length === 0) return res.status(404).send('Servidor não encontrado');
            
            const nomeServidor = servidor[0].nome.replace(/[^a-z0-9]/gi, '_').toLowerCase();

            // Busca anexos
            const [anexos] = await db.promise().query('SELECT nome_arquivo, conteudo FROM anexos WHERE titular_id = ?', [id]);
            
            if (anexos.length === 0) return res.status(404).send('Nenhum anexo encontrado');

            res.attachment(`documentos_${nomeServidor}.zip`);

            const archive = archiver('zip', { zlib: { level: 9 } });

            archive.on('error', function(err) {
                res.status(500).send({error: err.message});
            });

            archive.pipe(res);

            for (const anexo of anexos) {
                let buffer;
                const matches = anexo.conteudo.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                if (matches && matches.length === 3) {
                    buffer = Buffer.from(matches[2], 'base64');
                } else {
                    buffer = Buffer.from(anexo.conteudo, 'base64');
                }
                archive.append(buffer, { name: anexo.nome_arquivo });
            }

            archive.finalize();
        } catch (e) {
            console.error(e);
            res.status(500).send('Erro ao gerar ZIP');
        }
    });

    // Endpoint para buscar rascunho/cadastro pelo CPF (Retomar Cadastro)
    app.get('/api/cadastro/:cpf', async (req, res) => {
        const { cpf } = req.params;

        // 1. Validação: Verifica se contém apenas números
        if (!/^\d+$/.test(cpf)) {
            return res.status(400).json({ error: 'Formato de CPF inválido. Envie apenas números.' });
        }

        // 2. Validação: Verifica o tamanho (11 dígitos)
        if (cpf.length !== 11) {
            return res.status(400).json({ error: 'CPF deve conter 11 dígitos.' });
        }

        // Formata para o padrão do banco (000.000.000-00)
        const cpfFormatado = cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");

        try {
            const [rows] = await db.promise().query('SELECT * FROM titulares WHERE cpf = ? AND deleted_at IS NULL', [cpfFormatado]);
            
            if (rows.length === 0) {
                return res.status(404).json({ error: 'Nenhum cadastro encontrado para este CPF.' });
            }

            const titular = rows[0];

            // Formata datas do titular para YYYY-MM-DD (compatível com input type="date")
            Object.keys(titular).forEach(key => {
                if (titular[key] instanceof Date) {
                    titular[key] = titular[key].toISOString().split('T')[0];
                }
            });

            // Busca dados relacionados (Cônjuge e Dependentes)
            const [conjuges] = await db.promise().query('SELECT * FROM conjuges WHERE titular_id = ?', [titular.id]);
            const [dependentes] = await db.promise().query('SELECT * FROM dependentes WHERE titular_id = ?', [titular.id]);
            const [anexos] = await db.promise().query('SELECT nome_arquivo, tipo_arquivo, conteudo FROM anexos WHERE titular_id = ?', [titular.id]);

            const conjuge = conjuges.length > 0 ? conjuges[0] : null;
            
            // Monta a resposta estruturada para o frontend
            const responseData = {
                ...titular,
                conjuge: {
                    temConjuge: !!conjuge,
                    nome: conjuge?.nome || '',
                    cpf: conjuge?.cpf || '',
                    dataNasc: conjuge?.dataNasc ? conjuge.dataNasc.toISOString().split('T')[0] : ''
                },
                dependentes: dependentes.map(d => ({
                    nome: d.nome,
                    cpf: d.cpf,
                    parentesco: d.parentesco,
                    dataNasc: d.dataNasc ? d.dataNasc.toISOString().split('T')[0] : ''
                })),
                anexos: anexos.map(a => ({
                    nome: a.nome_arquivo,
                    tipo: a.tipo_arquivo,
                    conteudo: a.conteudo
                }))
            };

            res.json(responseData);

        } catch (error) {
            console.error('Erro ao buscar cadastro:', error);
            res.status(500).json({ error: 'Erro interno ao buscar dados.' });
        }
    });

    // Endpoint para adicionar um anexo individualmente (Upload Rápido na Ficha)
    app.post('/api/servidor/:id/anexo', async (req, res) => {
        const { id } = req.params;
        const { nome, tipo, conteudo } = req.body;

        if (!nome || !tipo || !conteudo) {
            return res.status(400).json({ error: 'Dados do anexo incompletos.' });
        }

        try {
            await db.promise().query('INSERT INTO anexos SET ?', { 
                titular_id: id, 
                nome_arquivo: nome, 
                tipo_arquivo: tipo, 
                conteudo: conteudo 
            });
            
            registrarAuditoria(req.headers['x-admin-id'], 'UPLOAD_ANEXO', id, `Anexo adicionado: ${nome}`);
            res.json({ message: 'Documento anexado com sucesso!' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Erro ao salvar anexo.' });
        }
    });

    app.post('/api/cadastro', async (req, res) => {
        const { titular, conjuge, dependentes, anexos, status } = req.body;

        if (!titular || !titular.cpf || !titular.nome) {
            return res.status(400).json({ error: 'Dados inválidos. Nome e CPF são obrigatórios para salvar.' });
        }

        // Verifica se o CPF já existe na base de dados para evitar duplicidade
        try {
            const [rows] = await db.promise().query('SELECT id, deleted_at FROM titulares WHERE cpf = ?', [titular.cpf]);
            if (rows.length > 0) {
                if (rows[0].deleted_at) {
                    return res.status(400).json({ error: 'Este CPF encontra-se na Lixeira. Restaure-o pelo painel administrativo ou exclua-o permanentemente para realizar um novo cadastro.' });
                }
                return res.status(400).json({ error: 'Este CPF já está cadastrado no sistema.' });
            }
        } catch (error) {
            return res.status(500).json({ error: 'Erro interno ao verificar duplicidade de CPF.' });
        }

        // Validação de tamanho dos anexos (Limite de 25MB)
        if (anexos && anexos.length > 0) {
            let totalSize = 0;
            for (const anexo of anexos) {
                if (anexo.conteudo) {
                    const content = anexo.conteudo.includes(',') ? anexo.conteudo.split(',')[1] : anexo.conteudo;
                    totalSize += (content.length * 3) / 4;
                }
            }
            const MAX_MB = 25;
            if (totalSize > MAX_MB * 1024 * 1024) {
                return res.status(400).json({ error: `O tamanho total dos anexos excede o limite permitido de ${MAX_MB}MB.` });
            }
        }

        // Sanitização de dados (converte strings vazias em null para evitar erros de data/número no MySQL)
        if (titular) {
            Object.keys(titular).forEach(key => {
                if (typeof titular[key] === 'string' && titular[key].trim() === '') titular[key] = null;
            });
            if (titular.salarioBase) {
                const salarioLimpo = titular.salarioBase.toString().replace(/[^\d,]/g, '').replace(',', '.');
                titular.salarioBase = salarioLimpo === '' ? null : salarioLimpo;
            }
        }
        if (conjuge) {
            Object.keys(conjuge).forEach(key => {
                if (typeof conjuge[key] === 'string' && conjuge[key].trim() === '') conjuge[key] = null;
            });
        }
        if (dependentes) {
            dependentes.forEach(dep => {
                Object.keys(dep).forEach(key => {
                    if (typeof dep[key] === 'string' && dep[key].trim() === '') dep[key] = null;
                });
            });
        }

        db.getConnection((err, connection) => {
            if (err) return res.status(500).json({ error: 'Erro de conexão com o banco.' });

            connection.beginTransaction(async (err) => {
                if (err) { connection.release(); return res.status(500).json({ error: 'Erro ao iniciar transação.' }); }
                try {
                    const dadosTitular = { ...titular, status: status || 'finalizado' };
                    const [resultTitular] = await connection.promise().query('INSERT INTO titulares SET ?', dadosTitular);
                    const titularId = resultTitular.insertId;
                    if (conjuge && conjuge.temConjuge) {
                        await connection.promise().query('INSERT INTO conjuges SET ?', { titular_id: titularId, nome: conjuge.nome, cpf: conjuge.cpf, dataNasc: conjuge.dataNasc });
                    }
                    if (dependentes && dependentes.length > 0) {
                        for (const dep of dependentes) {
                            await connection.promise().query('INSERT INTO dependentes SET ?', { titular_id: titularId, nome: dep.nome, cpf: dep.cpf, parentesco: dep.parentesco, dataNasc: dep.dataNasc });
                        }
                    }
                    if (anexos && anexos.length > 0) {
                        for (const anexo of anexos) {
                            await connection.promise().query('INSERT INTO anexos SET ?', { titular_id: titularId, nome_arquivo: anexo.nome, tipo_arquivo: anexo.tipo, conteudo: anexo.conteudo });
                        }
                    }
                    await connection.promise().commit();
                    connection.release();
                    
                    registrarAuditoria(req.headers['x-admin-id'], 'CRIACAO', titularId, `Cadastro realizado: ${titular.nome}`);
                    res.json({ message: 'Cadastro realizado com sucesso!', id: titularId });
                } catch (error) {
                    await connection.promise().rollback();
                    connection.release();
                    res.status(500).json({ error: 'Erro ao salvar cadastro: ' + error.message });
                }
            });
        });
    });

    app.post('/api/login', (req, res) => {
        const { email, senha } = req.body;
        db.query('SELECT * FROM administradores WHERE email = ? AND senha = ?', [email, senha], (err, results) => {
            if (err) return res.status(500).json({ error: 'Erro interno.' });
            if (results.length > 0) {
                res.json({ 
                    message: 'Login OK', 
                    token: 'token-'+results[0].id, 
                    role: results[0].role,
                    id: results[0].id,
                    primeiroAcesso: results[0].primeiro_acesso 
                });
            } else {
                res.status(401).json({ error: 'Credenciais inválidas.' });
            }
        });
    });

    // --- ROTAS DE RECUPERAÇÃO DE SENHA (LINK POR EMAIL) ---

    app.post('/api/auth/esqueci-senha', (req, res) => {
        const { email } = req.body;
        
        db.query('SELECT id, nome FROM administradores WHERE email = ?', [email], async (err, results) => {
            if (err) return res.status(500).json({ error: 'Erro interno.' });
            if (results.length === 0) return res.status(404).json({ error: 'Email não encontrado.' });

            const admin = results[0];
            const token = crypto.randomBytes(20).toString('hex');
            const expires = new Date(Date.now() + 3600000); // 1 hora de validade

            db.query('UPDATE administradores SET reset_token = ?, reset_expires = ? WHERE id = ?', [token, expires, admin.id], async (err) => {
                if (err) return res.status(500).json({ error: 'Erro ao gerar token.' });

                const link = `http://localhost:3000/redefinir-senha.html?token=${token}`;

                try {
                    await transporter.sendMail({
                        from: `"SICASV Segurança" <${process.env.EMAIL_USER}>`,
                        to: email,
                        subject: 'Redefinição de Senha - SICASV',
                        html: `
                            <h3>Solicitação de Redefinição de Senha</h3>
                            <p>Olá <strong>${admin.nome}</strong>,</p>
                            <p>Recebemos uma solicitação para redefinir sua senha. Clique no link abaixo para criar uma nova senha:</p>
                            <p><a href="${link}" style="padding: 10px 20px; background-color: #0056b3; color: white; text-decoration: none; border-radius: 5px;">Redefinir Minha Senha</a></p>
                            <p><small>Ou copie e cole este link: ${link}</small></p>
                            <p>Este link expira em 1 hora.</p>
                        `
                    });
                    logEmail('SUCESSO', email, 'Link de Redefinição Enviado');
                    res.json({ message: 'Link de redefinição enviado para seu email.' });
                } catch (error) {
                    console.error('Erro envio email:', error);
                    logEmail('FALHA', email, 'Link de Redefinição', error.message);
                    res.status(500).json({ error: 'Erro ao enviar email.' });
                }
            });
        });
    });

    app.post('/api/auth/redefinir-senha', (req, res) => {
        const { token, novaSenha } = req.body;

        db.query('SELECT id, email FROM administradores WHERE reset_token = ? AND reset_expires > NOW()', [token], (err, results) => {
            if (err) return res.status(500).json({ error: 'Erro interno.' });
            if (results.length === 0) return res.status(400).json({ error: 'Token inválido ou expirado.' });

            db.query('UPDATE administradores SET senha = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?', [novaSenha, results[0].id], (err) => {
                if (err) return res.status(500).json({ error: 'Erro ao atualizar senha.' });
                res.json({ message: 'Senha alterada com sucesso! Você já pode fazer login.' });
            });
        });
    });

    app.post('/api/admin/novo', (req, res) => {
        const { nome, cpf, telefone, email } = req.body;
        const senha = crypto.randomBytes(4).toString('hex');
        db.query('INSERT INTO administradores (nome, cpf, telefone, email, senha, role) VALUES (?, ?, ?, ?, ?, "admin")', [nome, cpf, telefone, email, senha], async (err) => {
            if (err) return res.status(500).json({ error: 'Erro ao criar admin: ' + err.message });
            
            // Envio de Email Real
            try {
                await transporter.sendMail({
                    from: `"SICASV Admin" <${process.env.EMAIL_USER}>`,
                    to: email,
                    subject: 'Bem-vindo ao SICASV - Credenciais de Acesso',
                    html: `
                        <h3>Cadastro Realizado com Sucesso</h3>
                        <p>Olá <strong>${nome}</strong>,</p>
                        <p>Você foi cadastrado como administrador no sistema SICASV.</p>
                        <p><strong>Login:</strong> ${email}</p>
                        <p><strong>Senha Temporária:</strong> ${senha}</p>
                        <p><i>Por segurança, você deverá alterar esta senha no seu primeiro acesso.</i></p>
                    `
                });
                console.log(`\n[EMAIL ENVIADO] Novo Admin: ${email}\n`);
                logEmail('SUCESSO', email, 'Bem-vindo ao SICASV');
                res.json({ message: 'Admin criado. Credenciais enviadas para o email informado.' });
            } catch (error) {
                console.error('Erro ao enviar email:', error);
                logEmail('FALHA', email, 'Bem-vindo ao SICASV', error.message);
                res.json({ message: 'Admin criado, mas falha ao enviar email. Senha temporária: ' + senha });
            }
        });
    });

    app.post('/api/admin/reset-senha', (req, res) => {
        const { email } = req.body;
        const senha = crypto.randomBytes(4).toString('hex');
        
        // Atualiza a senha e força o primeiro_acesso = 1 para obrigar a troca
        db.query('UPDATE administradores SET senha = ?, primeiro_acesso = 1 WHERE email = ?', [senha, email], async (err, result) => {
            if (err) return res.status(500).json({ error: 'Erro ao resetar.' });
            if (result.affectedRows === 0) return res.status(404).json({ error: 'Email não encontrado.' });
            
            try {
                await transporter.sendMail({
                    from: `"SICASV Segurança" <${process.env.EMAIL_USER}>`,
                    to: email,
                    subject: 'SICASV - Recuperação de Senha',
                    html: `
                        <h3>Senha Redefinida</h3>
                        <p>Recebemos uma solicitação para redefinir sua senha.</p>
                        <p><strong>Nova Senha Temporária:</strong> ${senha}</p>
                        <p>Acesse o sistema e defina uma nova senha pessoal.</p>
                    `
                });
                console.log(`\n[EMAIL ENVIADO] Reset para: ${email}\n`);
                logEmail('SUCESSO', email, 'Recuperação de Senha');
                res.json({ message: 'Uma nova senha foi enviada para seu email.' });
            } catch (error) {
                console.error('Erro ao enviar email:', error);
                logEmail('FALHA', email, 'Recuperação de Senha', error.message);
                res.status(500).json({ error: 'Senha resetada no sistema, mas houve erro ao enviar o email.' });
            }
        });
    });

    // Rota para definir senha no primeiro acesso (Troca Obrigatória)
    app.post('/api/admin/definir-senha', (req, res) => {
        const { id, senha } = req.body;
        if (!senha) return res.status(400).json({ error: 'Nova senha é obrigatória.' });
        
        db.query('UPDATE administradores SET senha = ?, primeiro_acesso = 0 WHERE id = ?', [senha, id], (err) => {
            if (err) return res.status(500).json({ error: 'Erro ao definir senha.' });
            res.json({ message: 'Senha definida com sucesso! Acesso liberado.' });
        });
    });

    app.put('/api/servidor/:id', async (req, res) => {
        const { id } = req.params;
        const { titular, conjuge, dependentes, anexos, status } = req.body;

        if (!titular) {
            return res.status(400).json({ error: 'Dados do titular não fornecidos.' });
        }

        // Verifica se o CPF já existe em outro cadastro (exceto o atual)
        try {
            const [rows] = await db.promise().query('SELECT id FROM titulares WHERE cpf = ? AND id != ?', [titular.cpf, id]);
            if (rows.length > 0) {
                return res.status(400).json({ error: 'Este CPF já está cadastrado para outro servidor.' });
            }
        } catch (error) {
            return res.status(500).json({ error: 'Erro interno ao verificar duplicidade de CPF.' });
        }

        // Validação de tamanho dos anexos (Limite de 25MB)
        if (anexos && anexos.length > 0) {
            let totalSize = 0;
            for (const anexo of anexos) {
                if (anexo.conteudo) {
                    const content = anexo.conteudo.includes(',') ? anexo.conteudo.split(',')[1] : anexo.conteudo;
                    totalSize += (content.length * 3) / 4;
                }
            }
            const MAX_MB = 25;
            if (totalSize > MAX_MB * 1024 * 1024) {
                return res.status(400).json({ error: `O tamanho total dos anexos excede o limite permitido de ${MAX_MB}MB.` });
            }
        }

        // Sanitização de dados (converte strings vazias em null para evitar erros de data/número no MySQL)
        if (titular) {
            Object.keys(titular).forEach(key => {
                if (typeof titular[key] === 'string' && titular[key].trim() === '') titular[key] = null;
            });
            if (titular.salarioBase) {
                const salarioLimpo = titular.salarioBase.toString().replace(/[^\d,]/g, '').replace(',', '.');
                titular.salarioBase = salarioLimpo === '' ? null : salarioLimpo;
            }
        }
        if (conjuge) {
            Object.keys(conjuge).forEach(key => {
                if (typeof conjuge[key] === 'string' && conjuge[key].trim() === '') conjuge[key] = null;
            });
        }
        if (dependentes) {
            dependentes.forEach(dep => {
                Object.keys(dep).forEach(key => {
                    if (typeof dep[key] === 'string' && dep[key].trim() === '') dep[key] = null;
                });
            });
        }

        db.getConnection((err, connection) => {
            if (err) return res.status(500).json({ error: 'Erro de conexão com o banco.' });

            connection.beginTransaction(async (err) => {
                if (err) { connection.release(); return res.status(500).json({ error: 'Erro ao iniciar transação.' }); }
                try {
                    const dadosTitular = { ...titular, status: status || 'finalizado' };
                    await connection.promise().query('UPDATE titulares SET ? WHERE id = ?', [dadosTitular, id]);
                    await connection.promise().query('DELETE FROM conjuges WHERE titular_id = ?', [id]);
                    await connection.promise().query('DELETE FROM dependentes WHERE titular_id = ?', [id]);
                    
                    // Atualiza anexos apenas se forem enviados (evita deletar se o frontend não mandar o campo)
                    if (anexos !== undefined) {
                        await connection.promise().query('DELETE FROM anexos WHERE titular_id = ?', [id]);
                        if (anexos.length > 0) {
                            for (const anexo of anexos) {
                                await connection.promise().query('INSERT INTO anexos SET ?', { titular_id: id, nome_arquivo: anexo.nome, tipo_arquivo: anexo.tipo, conteudo: anexo.conteudo });
                            }
                        }
                    }

                    if (conjuge && conjuge.temConjuge) {
                        await connection.promise().query('INSERT INTO conjuges SET ?', { titular_id: id, nome: conjuge.nome, cpf: conjuge.cpf, dataNasc: conjuge.dataNasc });
                    }
                    if (dependentes && dependentes.length > 0) {
                        for (const dep of dependentes) {
                            await connection.promise().query('INSERT INTO dependentes SET ?', { titular_id: id, nome: dep.nome, cpf: dep.cpf, parentesco: dep.parentesco, dataNasc: dep.dataNasc });
                        }
                    }
                    await connection.promise().commit();
                    connection.release();

                    registrarAuditoria(req.headers['x-admin-id'], 'EDICAO', id, `Cadastro atualizado: ${titular.nome}`);
                    res.json({ message: 'Cadastro atualizado com sucesso!' });
                } catch (error) {
                    await connection.promise().rollback();
                    connection.release();
                    res.status(500).json({ error: 'Erro ao atualizar cadastro: ' + error.message });
                }
            });
        });
    });


    // --- ROTAS DE GESTÃO DE ADMINISTRADORES (MASTER) ---

    // Listar todos os administradores
    app.get('/api/admins', (req, res) => {
        db.query('SELECT id, nome, cpf, telefone, email, role FROM administradores ORDER BY nome ASC', (err, results) => {
            if (err) return res.status(500).json({ error: 'Erro ao listar administradores.' });
            res.json(results);
        });
    });

    // Editar dados do administrador
    app.put('/api/admin/:id', (req, res) => {
        const { id } = req.params;
        const { nome, cpf, telefone, email } = req.body;
        db.query('UPDATE administradores SET nome = ?, cpf = ?, telefone = ?, email = ? WHERE id = ?', 
            [nome, cpf, telefone, email, id], 
            (err) => {
                if (err) return res.status(500).json({ error: 'Erro ao atualizar admin: ' + err.message });
                res.json({ message: 'Dados do administrador atualizados com sucesso.' });
            }
        );
    });

    // Alterar senha do administrador (específico)
    app.put('/api/admin/:id/senha', (req, res) => {
        const { id } = req.params;
        const { senha } = req.body;
        if (!senha) return res.status(400).json({ error: 'Nova senha é obrigatória.' });
        
        db.query('UPDATE administradores SET senha = ? WHERE id = ?', [senha, id], (err) => {
            if (err) return res.status(500).json({ error: 'Erro ao alterar senha.' });
            res.json({ message: 'Senha alterada com sucesso.' });
        });
    });

    // Excluir administrador
    app.delete('/api/admin/:id', (req, res) => {
        const { id } = req.params;
        db.query('DELETE FROM administradores WHERE id = ? AND role != "master"', [id], (err, result) => {
            if (err) return res.status(500).json({ error: 'Erro ao excluir admin.' });
            if (result.affectedRows === 0) return res.status(403).json({ error: 'Não foi possível excluir (verifique se é Master).' });
            res.json({ message: 'Administrador excluído com sucesso.' });
        });
    });

    // Excluir servidor
    app.delete('/api/servidor/:id', (req, res) => {
        const { id } = req.params;
        // Soft Delete: Apenas marca a data de exclusão
        db.query('UPDATE titulares SET deleted_at = NOW() WHERE id = ?', [id], (err, result) => {
            if (err) return res.status(500).json({ error: 'Erro ao excluir servidor.' });
            if (result.affectedRows === 0) return res.status(404).json({ error: 'Servidor não encontrado.' });
            registrarAuditoria(req.headers['x-admin-id'], 'EXCLUSAO', id, 'Servidor movido para a lixeira');
            res.json({ message: 'Servidor movido para a lixeira com sucesso.' });
        });
    });

    // --- ROTAS DA LIXEIRA ---

    app.get('/api/lixeira', (req, res) => {
        db.query('SELECT id, nome, cpf, cargo, deleted_at FROM titulares WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC', (err, results) => {
            if (err) return res.status(500).json({ error: 'Erro ao listar lixeira.' });
            res.json(results);
        });
    });

    app.put('/api/servidor/:id/restaurar', (req, res) => {
        const { id } = req.params;
        db.query('UPDATE titulares SET deleted_at = NULL WHERE id = ?', [id], (err, result) => {
            if (err) return res.status(500).json({ error: 'Erro ao restaurar.' });
            if (result.affectedRows === 0) return res.status(404).json({ error: 'Servidor não encontrado.' });
            
            registrarAuditoria(req.headers['x-admin-id'], 'RESTAURACAO', id, 'Servidor restaurado da lixeira');
            res.json({ message: 'Servidor restaurado com sucesso.' });
        });
    });

    app.delete('/api/lixeira/:id', (req, res) => {
        const { id } = req.params;
        db.query('DELETE FROM titulares WHERE id = ?', [id], (err, result) => {
            if (err) return res.status(500).json({ error: 'Erro ao excluir permanentemente.' });
            if (result.affectedRows === 0) return res.status(404).json({ error: 'Servidor não encontrado.' });
            
            registrarAuditoria(req.headers['x-admin-id'], 'EXCLUSAO_PERMANENTE', id, 'Servidor excluído permanentemente');
            res.json({ message: 'Servidor excluído permanentemente.' });
        });
    });

    // Rota para excluir dados de teste em massa (Limpeza)
    app.delete('/api/admin/excluir-testes', (req, res) => {
        const sql = "DELETE FROM titulares WHERE matricula LIKE 'TESTE%'";
        db.query(sql, (err, result) => {
            if (err) return res.status(500).json({ error: 'Erro ao excluir dados de teste.' });
            registrarAuditoria(req.headers['x-admin-id'], 'LIMPEZA_TESTES', null, `Excluídos ${result.affectedRows} registros de teste.`);
            res.json({ message: `${result.affectedRows} registros de teste excluídos permanentemente.` });
        });
    });

    // Rota de Backup do Banco de Dados (Dump SQL)
    app.get('/api/admin/backup', async (req, res) => {
        try {
            const [tables] = await db.promise().query('SHOW TABLES');
            let dump = `-- SICASV Backup Database\n-- Data: ${new Date().toLocaleString()}\n\nSET FOREIGN_KEY_CHECKS=0;\n\n`;

            for (const row of tables) {
                const tableName = Object.values(row)[0];
                
                // 1. Estrutura da Tabela
                const [create] = await db.promise().query(`SHOW CREATE TABLE \`${tableName}\``);
                dump += `-- Estrutura da tabela \`${tableName}\`\n`;
                dump += `DROP TABLE IF EXISTS \`${tableName}\`;\n${create[0]['Create Table']};\n\n`;

                // 2. Dados da Tabela
                const [rows] = await db.promise().query(`SELECT * FROM \`${tableName}\``);
                if (rows.length > 0) {
                    dump += `-- Dados da tabela \`${tableName}\`\n`;
                    dump += `INSERT INTO \`${tableName}\` VALUES `;
                    const values = rows.map(r => '(' + Object.values(r).map(v => db.escape(v)).join(',') + ')').join(',\n');
                    dump += `${values};\n\n`;
                }
            }
            dump += 'SET FOREIGN_KEY_CHECKS=1;\n';
            
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="backup_sicasv_${Date.now()}.sql"`);
            res.send(dump);
        } catch (error) {
            console.error('Erro no backup:', error);
            res.status(500).send('Erro ao gerar backup: ' + error.message);
        }
    });

    // Rota de Restauração de Backup (Upload e Execução de SQL)
    app.post('/api/admin/restore', (req, res) => {
        const { sql } = req.body;
        
        if (!sql || typeof sql !== 'string' || sql.trim().length === 0) {
            return res.status(400).json({ error: 'Conteúdo do arquivo inválido ou vazio.' });
        }

        const keywords = ['CREATE TABLE', 'INSERT INTO', 'DROP TABLE', 'SET FOREIGN_KEY_CHECKS'];
        const isValidSQL = keywords.some(key => sql.toUpperCase().includes(key));

        if (!isValidSQL) {
            return res.status(400).json({ error: 'O arquivo enviado não contém comandos SQL válidos ou reconhecíveis.' });
        }

        db.query(sql, (err) => {
            if (err) return res.status(500).json({ error: 'Erro ao restaurar banco de dados: ' + err.message });
            res.json({ message: 'Banco de dados restaurado com sucesso! O sistema foi atualizado.' });
        });
    });

    // Rota para enviar relatório PDF por email
    app.post('/api/admin/enviar-relatorio', async (req, res) => {
        const { email, pdfBase64, nomeRelatorio } = req.body;

        if (!email || !pdfBase64) {
            return res.status(400).json({ error: 'Email e conteúdo do PDF são obrigatórios.' });
        }

        // Remover prefixo do base64 se existir (data:application/pdf;base64,)
        const base64Data = pdfBase64.replace(/^data:application\/pdf;base64,/, "");

        try {
            await transporter.sendMail({
                from: `"SICASV Sistema" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: `Relatório SICASV - ${nomeRelatorio || 'Exportação'}`,
                html: `
                    <h3>Relatório Enviado</h3>
                    <p>Segue em anexo o relatório solicitado através do Painel Administrativo.</p>
                    <p><strong>Data:</strong> ${new Date().toLocaleString()}</p>
                `,
                attachments: [
                    {
                        filename: `${nomeRelatorio || 'relatorio'}.pdf`,
                        content: base64Data,
                        encoding: 'base64'
                    }
                ]
            });
            
            logEmail('SUCESSO', email, 'Envio de Relatório PDF');
            res.json({ message: 'Relatório enviado com sucesso!' });
        } catch (error) {
            console.error('Erro ao enviar relatório:', error);
            logEmail('FALHA', email, 'Envio de Relatório PDF', error.message);
            res.status(500).json({ error: 'Erro ao enviar email: ' + error.message });
        }
    });

    // Middleware global de erro para o Express (deve ser o último app.use)
    app.use((err, req, res, next) => {
        console.error('❌ Erro interno do servidor:', err.stack);
        res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });
    });

    app.listen(port, () => {
        console.log(`\n🚀 SISTEMA PRONTO!`);
        console.log(`👉 Acesse: http://localhost:${port}/home.html\n`);
    });
}

// Inicia o fluxo
// Tratamento de exceções não capturadas (Global)
process.on('uncaughtException', (err) => {
    console.error('🔥 CRÍTICO: Exceção não tratada capturada:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ ALERTA: Rejeição de Promise não tratada:', reason);
});

inicializarSistema();