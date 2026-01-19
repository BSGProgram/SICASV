CREATE DATABASE IF NOT EXISTS sicasv CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE sicasv;

CREATE TABLE IF NOT EXISTS servidores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    cpf VARCHAR(14) NOT NULL,
    rg VARCHAR(20),
    matricula VARCHAR(50),
    cargo VARCHAR(100),
    data_nasc DATE,
    endereco TEXT,
    tem_conjuge BOOLEAN DEFAULT FALSE,
    nome_conjuge VARCHAR(255),
    cpf_conjuge VARCHAR(14),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dependentes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    servidor_id INT,
    nome VARCHAR(255),
    parentesco VARCHAR(50),
    data_nasc DATE,
    FOREIGN KEY (servidor_id) REFERENCES servidores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;