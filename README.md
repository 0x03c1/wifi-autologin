# Wi-Fi AutoLogin

Mantém o computador conectado em redes Wi-Fi com **portal cativo** (aquela página que aparece pedindo
para aceitar termos ou fazer login) e refaz o login sozinho sempre que o portal pedir de novo.
Pensado para redes de faculdades e empresas com **login Microsoft (Azure AD / Entra ID)**, mas também
lida com portais simples de aceite de termos. Funciona no **macOS** e no **Windows 10/11**.

> Ele **não burla** autenticação: só automatiza o **seu** login, com a **sua** conta, do jeito que você
> faria clicando. Respeite a política de uso da rede.

## O problema

Em muitas redes, ao conectar aparece um portal como este:

1. marcar *"Aceito os termos de serviço"* → botão **Login Microsoft**
2. tela intermediária → **Continue**
3. tela da Microsoft (`login.microsoftonline.com`) → e-mail, senha, MFA

Isso volta a ser pedido com frequência, e cada vez é preciso digitar tudo de novo. As causas mais comuns:

| Causa | Por que acontece | Como este projeto resolve |
|---|---|---|
| O pop-up do sistema não guarda sessão | A janelinha de "entrar na rede" do macOS é um navegador "limpo": esquece o login toda vez | O login é feito num **perfil de navegador próprio**, onde a sessão "Manter conectado" fica salva |
| A sessão do portal expira | Tempo máximo ou inatividade definidos pela rede | O **vigia** checa a cada 10 s, detecta o portal e refaz o login em segundos |
| O computador dorme | Ao bloquear, o sistema dorme e o Wi-Fi desliga junto | Ao acordar, o vigia reconecta; veja também [Energia](#energia-bloquear-sem-cair) |
| Endereço MAC privado / aleatório | Se o MAC muda, o portal vê um "aparelho novo" | Ajuste recomendado: [MAC fixo](#endereço-mac-fixo) |

## Como funciona

```
 ┌──────────── vigia (a cada 10 s) ────────────┐
 │ GET http://captive.apple.com/hotspot-detect │
 └───────────────┬─────────────────────────────┘
       "Success" │  interceptado pelo portal
     (online,    │            │
   = keepalive)  │            ▼
                 │   login.mjs (navegador sem janela, perfil próprio)
                 │     1. marca o aceite de termos
                 │     2. clica nos botões do fluxo (Login Microsoft, Continue, Conectar...)
                 │     3. o SSO reconhece a sessão salva → internet liberada
                 │            │
                 │            └─ sessão expirou / pediu senha?
                 │                 → notificação + janela visível para você entrar uma vez
```

- **Nenhuma senha é armazenada.** O que fica salvo é o cookie de sessão do SSO, no perfil do
  navegador em `~/.wifi-autologin/` (fora do repositório). É o mesmo que acontece quando você marca
  "Manter conectado" no seu navegador.
- Usa o **Google Chrome** instalado. Se não houver, usa o **Microsoft Edge** (que já vem no Windows).
- Botões como *Visitante*, *Voucher*, *Cadastro* e links de *Termos/Privacidade* nunca são clicados.
- Log de eventos: `~/.wifi-autologin/watchdog.log`.

## Instalação

Pré-requisitos: **Node.js 18+** (o instalador tenta instalar se faltar) e **Google Chrome** (ou Edge).

Baixe o projeto (botão **Code → Download ZIP** ou `git clone`) e extraia numa pasta qualquer.

### macOS

```sh
cd wifi-autologin
./install.sh
```

### Windows 10/11

Dê **dois cliques em `install.cmd`**. Se o SmartScreen avisar, clique em *Mais informações → Executar assim mesmo*.

### O que o instalador faz

1. Verifica ou instala o Node.js (Homebrew no macOS, winget no Windows).
2. Copia o app para `~/.wifi-autologin/app` (no Windows, `%USERPROFILE%\.wifi-autologin\app`) e instala as dependências.
3. Registra o vigia para iniciar junto com o sistema:
   - macOS: LaunchAgent `com.wifi-autologin.watchdog`
   - Windows: Tarefa Agendada **Wi-Fi AutoLogin** (no logon, sem janela, reinicia se cair)
4. Abre o navegador para o **login inicial**: entre com sua conta Microsoft e marque
   **"Sim" em "Manter conectado?"**. Depois feche a janela.
   Se a sua rede não usa login Microsoft, só feche a janela (ou use `--no-setup` / `-NoSetup`).

Daqui em diante, quando o portal pedir login, o vigia resolve sozinho. Quando a sessão do SSO vencer
(em geral após alguns meses, conforme a política da organização), aparece uma notificação e uma janela
para você entrar uma vez.

### Desinstalar

- macOS: `./uninstall.sh` (adicione `--purge` para apagar também a sessão salva, a configuração e os logs)
- Windows: dois cliques em `uninstall.cmd` (ou `uninstall.ps1 -Purge`)

## Configuração (opcional)

Sem configuração, o vigia age em **qualquer** portal cativo e tenta botões comuns
(*Microsoft*, *Continue/Continuar*, *Conectar/Entrar/Login*, *Aceitar/OK*).

Para limitar a redes específicas ou definir os botões exatos, crie `~/.wifi-autologin/config.json`
(modelo em [`config.example.json`](config.example.json)):

```json
{
  "portals": [
    { "match": "portal.exemplo.edu.br", "steps": ["Login Microsoft", "Continue"] }
  ],
  "checkIntervalSeconds": 10
}
```

- `match`: trecho da URL ou da página do portal. Com a lista preenchida, **portais que não casam são ignorados**.
- `steps`: textos dos botões, em ordem de prioridade (opcional; sem ele, usa os botões comuns).
- `checkIntervalSeconds`: intervalo do vigia.

O arquivo é lido quando o vigia inicia. Depois de editar, reinicie o vigia (ou o computador).

## Ajustes recomendados

### Endereço MAC fixo

O portal libera o acesso por endereço MAC. Se ele mudar, o portal pede login de novo.

- **macOS:** Ajustes do Sistema → Wi-Fi → **(i)** ao lado da rede → *Endereço Wi-Fi privado* → **Fixo**
- **Windows:** Configurações → Rede e Internet → Wi-Fi → (rede) → *Endereços de hardware aleatórios* → **Desativado**

### Desligar o pop-up do macOS

A janelinha de portal do macOS pede credenciais do zero e, se você clicar em *Cancelar*, o Mac pode sair
da rede. Com o vigia instalado ela é desnecessária:

```sh
sudo defaults write /Library/Preferences/SystemConfiguration/com.apple.captive.control Active -bool false
# para voltar: ... Active -bool true
```

No Windows, o aviso de "fazer login na rede" abre o navegador padrão, que não atrapalha o vigia.

### Energia: bloquear sem cair

Bloquear a tela não derruba o Wi-Fi; **dormir** derruba. No macOS, é comum o sistema dormir
**1 minuto** depois que a tela apaga. Para não dormir enquanto estiver no carregador:

```sh
sudo pmset -c sleep 0      # no carregador: nunca dorme com a tela apagada
sudo pmset -b sleep 30     # opcional, na bateria: dorme só após 30 min
pmset -g custom            # conferir
```

Ou em Ajustes → Bateria → Opções → *Evitar repouso automático no adaptador de energia quando a tela estiver desligada*.
Bloqueie com **Ctrl + ⌘ + Q** sem fechar a tampa: com a tampa fechada o Mac sempre dorme (a menos que use monitor externo).

No Windows: Configurações → Sistema → Energia → *Tela e suspensão*, e, se existir, ative
*Permanecer conectado à rede em espera*.

Mesmo dormindo, ao acordar o vigia reconecta em segundos.

## Uso manual e diagnóstico

```sh
cd ~/.wifi-autologin/app
node src/login.mjs --setup   # refazer o login inicial (salvar sessão de novo)
node src/login.mjs           # forçar uma tentativa de login agora
tail -f ~/.wifi-autologin/watchdog.log
```

- **macOS:** status do vigia: `launchctl print gui/$(id -u)/com.wifi-autologin.watchdog | grep state`
- **Windows:** `Get-ScheduledTask -TaskName "Wi-Fi AutoLogin" | Select State`

| Mensagem no log | Significado |
|---|---|
| `online` | Internet liberada |
| `sem rede` | Wi-Fi desconectado ou computador acordando (normal) |
| `portal cativo detectado → login` → `clicou: …` → `conectado ✔` | O portal pediu login e o vigia resolveu |
| `o login (SSO) pediu credenciais` | A sessão salva expirou: entre na janela que abriu |
| `tempo esgotado` | O portal tem um fluxo diferente: configure `steps` no `config.json` ou abra uma *issue* com o log |
| `portal fora da lista do config.json` | Portal de outra rede; o vigia não interfere |

Se o login falhar várias vezes seguidas, o vigia espaça as tentativas (até 5 min) para não abrir janelas sem parar.

## Segurança e privacidade

- O repositório **não contém credenciais**, e-mails nem dados pessoais.
- A sessão fica só no seu computador, em `~/.wifi-autologin/browser-profile`. **Não compartilhe essa pasta**:
  quem tiver ela tem acesso à sua sessão Microsoft. Para apagar, rode o desinstalador com `--purge`/`-Purge`.
- Use `portals` no `config.json` se quiser que o vigia só aja nas redes que você conhece.

## Estrutura

```
src/config.mjs        URLs, padrões de botões e leitura do config.json (sem segredos)
src/login.mjs         automação do portal + SSO Microsoft (Playwright usando Chrome/Edge instalado)
src/watchdog.mjs      vigia: keepalive, detecção do portal, log
config.example.json   modelo de configuração
install.sh / uninstall.sh                  macOS (LaunchAgent)
install.cmd / install.ps1 / uninstall.*    Windows (Tarefa Agendada)
```

## Licença

[MIT](LICENSE)
