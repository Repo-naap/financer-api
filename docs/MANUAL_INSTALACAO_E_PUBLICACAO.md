# FINANCER – Manual de Instalação, Configuração e Publicação Online

Este manual apresenta todas as etapas necessárias para instalar, configurar o banco de dados PostgreSQL centralizado, publicar o FINANCER na internet com HTTPS, administrar usuários, realizar backups, restaurações e atualizações sem perda de dados.

---

## 1. Requisitos de Infraestrutura

- **Servidor Online (VPS Linux Ubuntu 22.04/24.04 ou Nuvem):** mínimo 2 GB RAM, 20 GB SSD, Docker e Docker Compose (ou Node.js 20+ e PostgreSQL 16).
- **Alternativa Gerenciada (PaaS):** Render.com (`render.yaml` já incluso) ou Railway (`railway.json` já incluso) com banco PostgreSQL gerenciado.
- **Computadores / Tablets / Celulares dos Usuários:** apenas um navegador moderno (Chrome, Edge, Firefox ou Safari). **Não é necessário instalar banco de dados em nenhum computador do escritório.**

---

## 2. Instalação e Publicação Online em Servidor Próprio (VPS Linux com HTTPS)

1. Copie a pasta completa do projeto FINANCER para o servidor Linux (ex.: `/opt/financer`).
2. Aponte um domínio ou subdomínio DNS (registro tipo `A`) para o IP público do servidor (ex.: `financer.seuescritorio.com.br`).
3. Execute o instalador automatizado:
   ```bash
   cd /opt/financer
   chmod +x scripts/*.sh
   ./scripts/install-linux.sh
   ```
4. O script executará automaticamente:
   - Instalação do Docker (se necessário);
   - Criação do `.env` com senhas fortes geradas aleatoriamente via `openssl rand`;
   - Subida do banco central **PostgreSQL 16** com volume persistente (`financer_pgdata`);
   - Subida do servidor **FINANCER** (backend + frontend compilados);
   - Subida do serviço de **backup automático diário** (`backup-cron`, retenção de 30 dias);
   - Subida do proxy **Caddy** com emissão e renovação automática de **certificado SSL/HTTPS (Let's Encrypt)**.

---

## 3. Publicação em Nuvem Gerenciada (Render.com ou Railway)

### 3.1. Via Render.com (com `render.yaml`)
1. Envie o código do projeto para um repositório privado no GitHub/GitLab.
2. Acesse o painel do Render &rarr; **New &rarr; Blueprint** e selecione o repositório.
3. O arquivo `render.yaml` criará automaticamente:
   - Banco de dados PostgreSQL gerenciado (`financer-db`);
   - Serviço Web Docker (`financer-gestao-financeira`) com HTTPS automático e `SESSION_SECRET` aleatório.
4. Após o deploy, configure um domínio próprio em **Settings &rarr; Custom Domains**.

### 3.2. Via Railway (com `railway.json`)
1. Crie um novo projeto no Railway, adicione um banco **PostgreSQL** e conecte o repositório.
2. Defina as variáveis de ambiente: `DATABASE_URL` (referência do serviço PostgreSQL), `DATABASE_SSL=true`, `SESSION_SECRET` (chave aleatória com 64+ caracteres) e `SERVE_FRONTEND=true`.

---

## 4. Instalação Local em Windows (Desenvolvimento ou Rede Interna)

1. Instale o **Node.js 22 LTS** e o **PostgreSQL 16** (opcionalmente, sem PostgreSQL instalado, o sistema utiliza o motor PostgreSQL embutido PGlite gravado em `./pglite-data` para testes).
2. Configure o arquivo `.env` a partir de `.env.example`, ajustando `DATABASE_URL` para seu servidor PostgreSQL.
3. Execute no PowerShell:
   ```powershell
   .\scripts\install-windows.ps1
   npm start
   ```
4. Acesse `http://localhost:3001` no navegador.

---

## 5. Primeiro Acesso (Configuração Inicial Segura)

O FINANCER **não possui senhas padrão fixas**. No primeiro acesso ao endereço publicado:

1. O sistema abrirá automaticamente a tela **Configuração Inicial Segura**.
2. Preencha:
   - Nome do escritório, CNPJ/documento, telefone;
   - Saldo inicial geral do caixa (R$);
   - Quantidade de dias de antecedência para alertas de vencimento (padrão: 5 dias);
   - Nome completo, login e senha forte (mínimo 8 caracteres) do primeiro **Administrador**.
3. Clique em **Concluir Configuração e Acessar**. A tela de configuração inicial é bloqueada permanentemente após essa etapa.

---

## 6. Como Acessar pelos Computadores do Escritório

1. Em qualquer computador, tablet ou celular conectado à internet, abra o navegador e acesse o endereço configurado (ex.: `https://financer.seuescritorio.com.br`).
2. Cada colaborador deverá fazer login com seu **usuário e senha individuais**.
3. Todos os lançamentos são gravados diretamente no banco PostgreSQL centralizado e sincronizados entre todos os usuários.
4. Caso a internet caia temporariamente, o FINANCER exibe uma faixa vermelha de **Offline** e impede a confirmação de operações não salvas no servidor.

---

## 7. Cadastro de Usuários, Permissões e Recuperação de Senha

1. Acesse o menu **Configurações &rarr; Usuários e Permissões** (exclusivo de Administradores).
2. Clique em **Novo Usuário**, informe nome, login, senha inicial (mín. 8 caracteres), situação (`Ativo`/`Inativo`) e perfil:
   - **ADMINISTRADOR:** acesso irrestrito, usuários, configurações, backups, auditoria e reabertura de períodos.
   - **FINANCEIRO:** inclusão, edição, exclusão e relatórios nos módulos financeiros.
   - **CONSULTA:** visualização e exportação de relatórios sem permissão de alteração.
   - **PERSONALIZADO:** abre uma matriz completa onde o administrador marca individualmente por aba quais ações o usuário pode executar (`Visualizar`, `Cadastrar`, `Editar`, `Excluir`, `Exportar`, `Fechar`).
3. **Recuperação de Senha:** clique no ícone de chave ao lado do usuário para gerar um **Código de Recuperação** de uso único (validade de 2 horas). O usuário informa esse código na tela de login em *"Esqueci minha senha"* para cadastrar uma nova senha.

---

## 8. Backup e Restauração

### 8.1. Pela Interface Web (Administrador)
- Acesse **Configurações &rarr; Backup, Restauração e Servidor**.
- Clique em **Gerar Novo Backup Agora** para criar uma cópia completa com verificação criptográfica **SHA-256**.
- Clique em **Baixar** para guardar uma cópia em local externo (nuvem, HD externo ou outro servidor).
- Para restaurar, clique em **Restaurar** em um backup salvo ou use **Restaurar de Arquivo (.json)**.

### 8.2. Via Linha de Comando (PostgreSQL nativo)
- **Backup manual:** `./scripts/backup-postgres.sh`
- **Backup automático diário:** já configurado no serviço `backup-cron` do `docker-compose.yml`. Recomenda-se sincronizar `./backups` com armazenamento externo (S3, Google Drive/rclone ou servidor secundário).
- **Restauração:** `./scripts/restore-postgres.sh ./backups/financer_pg_YYYYMMDD_HHMMSS.dump`

---

## 9. Como Atualizar o Sistema Sem Perda de Dados

O FINANCER utiliza migrações SQL versionadas (`backend/sql/migrations/`). Nunca edite dados diretamente no banco durante atualizações.

1. Execute `./scripts/update-system.sh`.
2. O script realiza automaticamente:
   - Backup preventivo obrigatório antes de qualquer alteração;
   - Recompilação da nova versão;
   - Aplicação automática apenas de migrações novas, preservando integralmente usuários, lançamentos financeiros, fechamentos, configurações e auditoria.

---

## 10. Checklist de Teste de Implantação Online

Após publicar o servidor online, valide:
- [ ] Acesso via HTTPS por dois computadores diferentes simultaneamente;
- [ ] Login simultâneo de dois usuários distintos (ex.: Administrador e Financeiro);
- [ ] Inclusão de despesa em um computador e visualização imediata no outro;
- [ ] Atualização automática dos gráficos no Painel Inicial;
- [ ] Geração e download de relatórios em PDF, Excel (.xlsx) e Word (.docx);
- [ ] Bloqueio de permissão ao tentar alterar lançamentos com perfil CONSULTA;
- [ ] Fechamento mensal bloqueando novos lançamentos na competência fechada;
- [ ] Execução de backup, teste de restauração e verificação da persistência após reinicialização do container (`docker compose restart`).
