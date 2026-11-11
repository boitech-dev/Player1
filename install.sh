#!/bin/sh
# Player1 installer:  curl -fsSL https://raw.githubusercontent.com/boitech-dev/Player1/master/install.sh | sh
# Docker Compose when available, else directly on this machine (systemd). Asks about this machine (port, folders)
# and how Player1 will be opened, in the terminal (arrow keys, Enter), then puts that in place itself:
#   1  at home only                    http://<this machine>:<port>
#   2  from anywhere, your own domain  HTTPS through Player1's own Caddy, or through the Apache / Nginx / Caddy
#                                      that already answers on ports 80 and 443 here
#   3  from anywhere, no domain        Tailscale: https://<machine>.<tailnet>.ts.net, for your devices only
# The services (Real-Debrid, TMDB, torrent site, qBittorrent, Jellyfin) are set up in the browser afterwards, from
# the link printed at the end.
# Afterwards the machine has a "player1" command: a menu to see the address, change these answers, restart, read the
# log, or remove the install. Running this installer again on a machine that has Player1 opens the same menu.
set -eu
REPO="${PLAYER1_REPO:-https://github.com/boitech-dev/Player1.git}"
NODE_MAJOR=26
CADDY_V=2.11.9 # also in compose.yml

# --- the terminal: arrow-key menus, answers that fold away, spinners for the long steps. Plain sh, nothing to install.
# Without a real terminal (TERM=dumb, no /dev/tty settings) the same questions are asked as numbered lists.
ESC=$(printf '\033'); CR=$(printf '\r'); NL='
'
LOG="${TMPDIR:-/tmp}/player1-install.$$"
SAVED=$(stty -g < /dev/tty 2>/dev/null || true)
TUI=; [ -z "$SAVED" ] || [ "${TERM:-dumb}" = dumb ] || [ ! -t 1 ] || TUI=1
if [ -n "$TUI" ] && [ -z "${NO_COLOR:-}" ]; then cB="$ESC[1m"; cD="$ESC[2m"; cY="$ESC[38;5;221m"; cV="$ESC[38;5;141m"; cG="$ESC[38;5;114m"; cR="$ESC[38;5;203m"; c0="$ESC[0m"
else cB=; cD=; cY=; cV=; cG=; cR=; c0=; fi
case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
  *[Uu][Tt][Ff]*) sASK='◆'; sDONE='◇'; sON='●'; sOFF='○'; sBAR='│'; sTOP='┌'; sEND='└'; sOK='✔'; sKO='✖'; sWARN='▲'; sNONE='—'; FRAMES='⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏' ;;
  *) sASK='?'; sDONE='-'; sON='>'; sOFF=' '; sBAR='|'; sTOP='+'; sEND='+'; sOK='+'; sKO='x'; sWARN='!'; sNONE='-'; FRAMES='| / - \' ;;
esac
G="$cV$sBAR$c0" # the line down the left side
restore() { [ -z "$SAVED" ] || stty "$SAVED" < /dev/tty 2>/dev/null || true; [ -z "$TUI" ] || printf '%s' "$ESC[?25h$ESC[?7h"; rm -f "$LOG"; }
trap restore EXIT; trap 'exit 130' INT TERM

case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in fr*) FR=1 ;; *) FR= ;; esac
t() { if [ -n "$FR" ]; then printf %s "$1"; else printf %s "$2"; fi; } # t <fr> <en>
say() { printf '%s\n' "$G  $(t "$1" "$2")"; }
ok() { printf '%s\n' "$cG$sOK$c0  $(t "$1" "$2")"; }
warn() { printf '%s\n' "$cY$sWARN$c0  $(t "$1" "$2")"; }
die() { printf '%s\n' "$cR$sKO$c0  $(t "$1" "$2")" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

key() { # one key press, in $K: up, down, enter, or the character itself
  K=$(dd bs=1 count=1 2>/dev/null < /dev/tty; echo .); K=${K%.}
  case "$K" in
    "$ESC") stty min 0 time 1 < /dev/tty; K=$(dd bs=1 count=2 2>/dev/null < /dev/tty); stty min 1 time 0 < /dev/tty
      case "$K" in '[A'|OA) K=up ;; '[B'|OB) K=down ;; *) K= ;; esac ;;
    k) K=up ;; j) K=down ;; ""|"$NL"|"$CR") K=enter ;;
  esac
}
PICK=
pick() { # pick <var> <question> <value|label|hint>...: arrows (or j k, or its number) then Enter; the first is the default
  _var=$1; _q=$2; shift 2; _n=$#; _i=1
  _j=0; for _o; do _j=$((_j + 1)); [ "${_o%%|*}" != "$PICK" ] || _i=$_j; done; PICK= # $PICK: the value to start on
  printf '%s\n' "$cV$sASK$c0  $cB$_q$c0"
  if [ -n "$TUI" ]; then
    stty -icanon -echo min 1 time 0 < /dev/tty; printf '%s' "$ESC[?25l$ESC[?7l" # no cursor, no line wrap while it redraws
    while :; do
      _j=0; for _o; do _j=$((_j + 1)); _l=${_o#*|}; _h=${_l#*|}; _l=${_l%%|*}
        if [ "$_j" = "$_i" ]; then printf '%s\n' "$ESC[2K$G  $cY$sON$c0 $cB$_l$c0  $cD$_h$c0"; else printf '%s\n' "$ESC[2K$G  $cD$sOFF $_l  $_h$c0"; fi
      done
      key
      case "$K" in
        up) _i=$((_i - 1)); [ "$_i" -ge 1 ] || _i=$_n ;;
        down) _i=$((_i + 1)); [ "$_i" -le "$_n" ] || _i=1 ;;
        [1-9]) [ "$K" -gt "$_n" ] || _i=$K ;;
        enter) break ;;
      esac
      printf '%s' "$ESC[${_n}A"
    done
    stty "$SAVED" < /dev/tty; printf '%s' "$ESC[?25h$ESC[?7h$ESC[$((_n + 1))A$ESC[J"
  else
    _j=0; for _o; do _j=$((_j + 1)); _l=${_o#*|}; printf '%s\n' "$G  $_j  ${_l%%|*}  ${_l#*|}"; done
    printf '%s' "$G  [1] "; read -r _a < /dev/tty || _a=""
    case "$_a" in [1-9]) [ "$_a" -gt "$_n" ] || _i=$_a ;; esac
  fi
  _j=0; for _o; do _j=$((_j + 1)); [ "$_j" != "$_i" ] || { _val=${_o%%|*}; _l=${_o#*|}; _l=${_l%%|*}; }; done
  [ -z "$TUI" ] || printf '%s\n%s\n' "$cV$sDONE$c0  $_q" "$G  $cD$_l$c0"
  printf '%s\n' "$G"; eval "$_var=\$_val"
}
ask() { # ask <var> <default> <fr question> <en question> [<fr hint> <en hint>]: a line of text; Enter alone keeps the default
  _q=$(t "$3" "$4")
  if [ -n "$2" ]; then _h="$(t "Entrée pour garder" "Enter to keep") $2"; else _h=$(t "Entrée pour passer" "Enter to skip"); fi
  [ $# -le 4 ] || _h=$(t "$5" "$6"); _tone=$cD
  if [ -n "$WHY" ]; then _tone=$cY; if [ -n "$2" ]; then _h="$sWARN $WHY $_h"; else _h="$sWARN $WHY"; fi; WHY=; fi
  printf '%s\n%s\n%s' "$cV$sASK$c0  $cB$_q$c0" "$G  $_tone$_h$c0" "$G  "
  read -r _a < /dev/tty || _a=""
  _a=${_a:-$2}
  [ -z "$TUI" ] || printf '%s\n%s\n' "$ESC[3A$ESC[J$cV$sDONE$c0  $_q" "$G  $cD${_a:-$sNONE}$c0"
  printf '%s\n' "$G"; eval "$1=\$_a"
}
WHY=
retry() { # retry <fr> <en>: the last answer can't be used. Its lines go, and the question asked next says why.
  WHY=$(t "$1" "$2"); [ -z "$TUI" ] || printf '%s' "$ESC[3A$ESC[J"
}
step() { # step <label> <command...>: runs it with its output kept aside ($LOG), behind a spinner; then ✔ or ✖ and its status
  _l=$1; shift; _t0=$(date +%s)
  "$@" > "$LOG" 2>&1 & _pid=$!
  if [ -n "$TUI" ]; then
    printf '%s' "$ESC[?25l"
    while kill -0 "$_pid" 2>/dev/null; do
      for _f in $FRAMES; do
        _s=$(($(date +%s) - _t0)); _c=; [ "$_s" -lt 5 ] || _c=$(printf '%d:%02d' $((_s / 60)) $((_s % 60)))
        printf '\r%s' "$ESC[2K$cY$_f$c0  $_l  $cD$_c$c0"; sleep 0.1 2>/dev/null || sleep 1
        kill -0 "$_pid" 2>/dev/null || break
      done
    done
    printf '\r%s' "$ESC[2K$ESC[?25h"
  fi
  if wait "$_pid"; then printf '%s\n' "$cG$sOK$c0  $_l"; else printf '%s\n' "$cR$sKO$c0  $_l"; return 1; fi
}
failed() { tail -n 12 "$LOG" 2>/dev/null | sed "s/^/$sBAR  /"; die "$@"; } # what the step said, then the error
SUDO=""; [ "$(id -u)" = 0 ] || { have sudo && SUDO=sudo; }
auth() { # the sudo password, asked once and in plain sight, before quiet steps need it
  [ -n "$SUDO" ] || return 0; ! $SUDO -n true 2>/dev/null || return 0
  say "Ton mot de passe, pour régler cette machine :" "Your password, to set up this machine:"; $SUDO -p "$sBAR  " -v
}
need_root() { [ "$(id -u)" = 0 ] || [ -n "$SUDO" ] || die "ce choix demande les droits administrateur (sudo)" "this choice needs administrator rights (sudo)"; auth; }
pkg() { if have apt-get; then $SUDO apt-get install -y "$@" >/dev/null; elif have dnf; then $SUDO dnf install -y "$@" >/dev/null; else return 1; fi; }

# --- how Player1 is reached ---
open_ports() { # this machine's own firewall, when one is running
  [ "$(id -u)" = 0 ] || [ -n "$SUDO" ] || return 0
  have ufw || have firewall-cmd || return 0; auth
  if have ufw && $SUDO ufw status 2>/dev/null | grep -q '^Status: active'; then for p in "$@"; do $SUDO ufw allow "$p/tcp" >/dev/null; done
  elif have firewall-cmd && $SUDO firewall-cmd --state >/dev/null 2>&1; then
    for p in "$@"; do $SUDO firewall-cmd -q --permanent --add-port="$p/tcp"; done; $SUDO firewall-cmd -q --reload
  fi
}
listening() { { ss -ltnH 2>/dev/null || netstat -ltn 2>/dev/null; } | awk '{print $4}' | grep -qE ":($1)\$"; } # listening <port|port>
web_server() { # what already answers on ports 80 / 443 here: apache, nginx, caddy, other, or nothing
  listening '80|443' || return 0
  # a server in a container has its process here but no settings folder: that one is "other"
  if [ -d /etc/apache2 ] && pgrep -x apache2 >/dev/null; then echo apache
  elif [ -d /etc/httpd ] && pgrep -x httpd >/dev/null; then echo apache
  elif [ -d /etc/nginx ] && pgrep -x nginx >/dev/null; then echo nginx
  elif [ -f /etc/caddy/Caddyfile ] && pgrep -x caddy >/dev/null; then echo caddy
  else echo other; fi
}
check_dns() { # the two things only the owner can do: the domain's DNS record, the router's ports
  PUB=$(curl -fsS4 --max-time 5 https://icanhazip.com 2>/dev/null || true)
  DNS=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)
  [ -n "$PUB" ] || return 0
  if [ -z "$DNS" ]; then warn "À faire : $DOMAIN n'existe pas encore. Chez ton fournisseur de nom de domaine, crée un enregistrement A : $DOMAIN → $PUB" \
    "To do: $DOMAIN doesn't exist yet. At your domain name provider, create an A record: $DOMAIN → $PUB"
  elif [ "$DNS" != "$PUB" ]; then warn "À vérifier : $DOMAIN pointe vers $DNS, mais l'adresse de cette machine sur internet est $PUB. Chez ton fournisseur de nom de domaine, l'enregistrement A doit être : $DOMAIN → $PUB" \
    "To check: $DOMAIN points to $DNS, but this machine's address on the internet is $PUB. At your domain name provider, the A record should be: $DOMAIN → $PUB"
  fi
  hostname -I 2>/dev/null | grep -qw "$PUB" || warn "À faire : sur ta box internet (ou ton routeur), redirige les ports 80 et 443 vers cette machine ($IP)." \
    "To do: on your internet router, forward ports 80 and 443 to this machine ($IP)."
}
site() { # site <example file> <where>: the example, for this domain and port
  { echo "# written by Player1's installer"; sed -e '/^#/d' -e "s/player\.example\.com/$DOMAIN/g" -e "s/127\.0\.0\.1:6510/127.0.0.1:$PORT/g" "$1"; } | $SUDO tee "$2" >/dev/null
  ! have setsebool || $SUDO setsebool -P httpd_can_network_connect 1 2>/dev/null || true
}
cert() { # cert <apache|nginx>: HTTPS for the site just written, from Let's Encrypt
  have certbot || pkg certbot "python3-certbot-$1" || die "installe certbot, puis relance cette installation" "install certbot, then run this installer again"
  say "Certificat HTTPS (Let's Encrypt) :" "HTTPS certificate (Let's Encrypt):"
  $SUDO certbot "--$1" --redirect --keep-until-expiring -d "$DOMAIN" < /dev/tty || true
}
front_apache() {
  if [ -d /etc/apache2/sites-available ]; then site docs/apache.conf.example /etc/apache2/sites-available/player1.conf; $SUDO a2enmod -q proxy proxy_http headers; $SUDO a2ensite -q player1
  else site docs/apache.conf.example /etc/httpd/conf.d/player1.conf; fi
  $SUDO apachectl configtest 2>/dev/null; $SUDO systemctl reload apache2 2>/dev/null || $SUDO systemctl reload httpd
  ok "Site $DOMAIN ajouté à Apache" "Site $DOMAIN added to Apache"; cert apache
}
front_nginx() {
  if [ -d /etc/nginx/sites-enabled ]; then site docs/nginx.conf.example /etc/nginx/sites-available/player1; $SUDO ln -sf ../sites-available/player1 /etc/nginx/sites-enabled/player1
  else site docs/nginx.conf.example /etc/nginx/conf.d/player1.conf; fi
  $SUDO nginx -t 2>/dev/null; $SUDO systemctl reload nginx
  ok "Site $DOMAIN ajouté à Nginx" "Site $DOMAIN added to Nginx"; cert nginx
}
front_caddy() { # a Caddy already installed on this machine: one more site in its file
  grep -q "^$DOMAIN " /etc/caddy/Caddyfile || printf '\n%s {\n\treverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$PORT" | $SUDO tee -a /etc/caddy/Caddyfile >/dev/null
  $SUDO systemctl reload caddy; ok "Site $DOMAIN ajouté à Caddy" "Site $DOMAIN added to Caddy"
}
front_own() { # Player1's own Caddy: a compose service in Docker, else its official build (checksum checked) and a systemd unit
  UP=player1:6510; [ "$MODE" = docker ] || UP="127.0.0.1:$PORT"
  mkdir -p data/caddy; printf '# written by install.sh\n%s {\n\treverse_proxy %s\n}\n' "$DOMAIN" "$UP" > "$OWN"
  open_ports 80 443
  [ "$MODE" != docker ] || return 0
  if [ "$(data/runtime/caddy version 2>/dev/null | cut -d' ' -f1)" != "v$CADDY_V" ]; then
    F="caddy_${CADDY_V}_linux_$(uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/').tar.gz"; U="https://github.com/caddyserver/caddy/releases/download/v$CADDY_V"
    mkdir -p data/runtime/dl && cd data/runtime/dl
    curl -fsSLO "$U/$F" && curl -fsSL "$U/caddy_${CADDY_V}_checksums.txt" | grep " $F\$" | sha512sum -c - >/dev/null \
      || die "téléchargement de Caddy invalide" "Caddy download failed its checksum"
    tar -xzf "$F" caddy && mv caddy ../caddy; cd "$DIR"; rm -rf data/runtime/dl
  fi
  printf '%s\n' "[Unit]
Description=Player1's front door (Caddy: HTTPS for $DOMAIN)
After=network-online.target
[Service]
User=$(id -un)
Environment=XDG_DATA_HOME=$DIR/data/caddy XDG_CONFIG_HOME=$DIR/data/caddy
ExecStart=$DIR/data/runtime/caddy run --config $DIR/$OWN --adapter caddyfile --watch
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target" | $SUDO tee /etc/systemd/system/player1-caddy.service >/dev/null
  $SUDO systemctl daemon-reload && $SUDO systemctl enable --now player1-caddy
}
front_tailscale() { # this machine on the owner's Tailscale network, and Player1 served on it in HTTPS
  if ! have tailscale; then
    pick TS "$(t "Tailscale n'est pas encore sur cette machine. L'installer ?" "Tailscale isn't on this machine yet. Install it?")" "y|$(t Oui Yes)|" "n|$(t Non No)|"
    [ "$TS" = y ] || die "ce choix a besoin de Tailscale" "this choice needs Tailscale"
    step "$(t "Installation de Tailscale" "Installing Tailscale")" sh -c 'curl -fsSL https://tailscale.com/install.sh | sh' || failed "Tailscale ne s'est pas installé" "Tailscale didn't install"
  fi
  if ! tailscale status >/dev/null 2>&1; then
    say "Relie cette machine à ton compte Tailscale : ouvre le lien qui s'affiche ci-dessous." "Link this machine to your Tailscale account: open the link shown below."
    $SUDO tailscale up
  fi
  # already served by an earlier run: same address. Else port 443, or 8443 when something else is served there.
  URL=$(tailscale serve status 2>/dev/null | awk -v t="http://127.0.0.1:$PORT" '/^https:/ { u = $1 } index($0, t) { print u; exit }')
  [ -z "$URL" ] || { ok "Player1 est déjà servi sur ton réseau Tailscale" "Player1 is already served on your Tailscale network"; return 0; }
  NAME=$(tailscale status --json | sed -n 's/.*"DNSName": *"\([^"]*\)".*/\1/p' | head -1 | sed 's/\.$//')
  [ -n "$NAME" ] || die "active MagicDNS dans la console Tailscale (onglet DNS), puis relance cette installation" "turn on MagicDNS in the Tailscale admin console (DNS tab), then run this installer again"
  if tailscale serve status 2>/dev/null | grep -q '^https:'; then TSPORT=8443; URL="https://$NAME:8443"; else TSPORT=443; URL="https://$NAME"; fi
  $SUDO tailscale serve --bg --https="$TSPORT" "http://127.0.0.1:$PORT" > "$LOG" 2>&1 || failed "Tailscale n'a pas pu servir Player1" "Tailscale couldn't serve Player1"
  ok "Player1 est servi sur ton réseau Tailscale" "Player1 is served on your Tailscale network"
}

# --- removing an install:  install.sh uninstall ---
project_of() { docker ps -a --filter "label=com.docker.compose.project.working_dir=$1" --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null | head -1; } # the Docker project of the containers started from a folder
# The installs on this machine: their folders are noted in $REG, and a "player1" command opens their menu.
REG="$HOME/.config/player1/installs" # one folder per line
MARK="# Player1: its menu on this machine"
installs() { # the folders: noted by the installer, seen running, or in the usual place
  { cat "$REG" 2>/dev/null || true
    ! have docker || docker ps -a --filter label=com.docker.compose.service=player1 --format '{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null || true
    sed -n 's/^WorkingDirectory=//p' /etc/systemd/system/player1.service "$HOME/.config/systemd/user/player1.service" 2>/dev/null || true
    echo "$HOME/player1" # the usual folder, even when nothing of it runs
  } | awk 'NF && !seen[$0]++' | while read -r _d; do if [ -f "$_d/run.mjs" ] && [ -f "$_d/.env" ]; then echo "$_d"; fi; done
}
port_of() { # port_of <folder>: from its .env, its service, or its container
  _p=$(sed -n 's/^PORT=//p' "$1/.env" 2>/dev/null | head -1)
  [ -n "$_p" ] || _p=$(grep -ls "^WorkingDirectory=$1\$" /etc/systemd/system/player1.service "$HOME/.config/systemd/user/player1.service" 2>/dev/null | head -1 | xargs -r sed -n 's/^Environment=PORT=\([0-9]*\).*/\1/p')
  [ -n "$_p" ] || ! have docker || _p=$(docker ps --filter "label=com.docker.compose.project.working_dir=$1" --format '{{.Ports}}' 2>/dev/null | sed -n 's/.*:\([0-9]*\)->6510.*/\1/p' | head -1)
  echo "$_p"
}
address_of() { # address_of <folder>: where that install is opened (set by the installer, else in the app, else its port)
  _u=$(sed -n 's/^PUBLIC_URL=//p' "$1/.env" 2>/dev/null | head -1)
  [ -n "$_u" ] || _u=$(sed -n 's/.*"PUBLIC_URL": *"\([^"]*\)".*/\1/p' "$1/data/config.json" 2>/dev/null | head -1)
  [ -n "$_u" ] || _u="http://$(hostname -I 2>/dev/null | cut -d' ' -f1):$(port_of "$1")"
  echo "$_u"
}
command_path() { # the command's file: in a folder of the PATH this user can write to, else ~/.local/bin
  for _d in "$HOME/.local/bin" "$HOME/bin" /usr/local/bin; do case ":$PATH:" in *":$_d:"*) if [ -w "$_d" ]; then echo "$_d/player1"; return; fi ;; esac; done
  echo "$HOME/.local/bin/player1"
}
remember() { # remember <folder>: noted, and the command written. $CALL is what to type.
  mkdir -p "$(dirname "$REG")"; grep -qxF "$1" "$REG" 2>/dev/null || echo "$1" >> "$REG"; echo "$L" > "$REG.lang"
  CALL=$(command_path); mkdir -p "$(dirname "$CALL")"
  printf '%s\n' '#!/bin/sh' "$MARK (address, settings, removal). Written by Player1's installer." \
    'while read -r d; do [ ! -f "$d/install.sh" ] || exec sh "$d/install.sh" menu; done < "$HOME/.config/player1/installs"' \
    'echo "Player1 is not installed on this machine any more."' > "$CALL"
  chmod +x "$CALL"; case ":$PATH:" in *":$(dirname "$CALL"):"*) CALL=player1 ;; esac
}
forget() { # forget <folder>: no longer noted; the command goes with the last install
  [ -f "$REG" ] || return 0
  grep -vxF "$1" "$REG" > "$REG.tmp" || true; mv "$REG.tmp" "$REG"
  [ -s "$REG" ] || { rm -f "$REG" "$REG.lang"; _c=$(command_path); ! grep -qs "^$MARK" "$_c" || rm -f "$_c"; }
}
outro() { # outro <fr> <en> [<line>]: the last panel, with the line to remember
  printf '%s\n\n' "$cV$sEND$c0  $cB$(t "$1" "$2")$c0"; [ $# -lt 3 ] || printf '   %s\n\n' "$cY$3$c0"
}
menu() { # menu <folder>: what to do with an install. Returns only to change its settings; else it ends here.
  DIR=$1; ADDR=$(address_of "$DIR"); cd "$DIR"
  pick DO "$(t "Player1, dans $DIR" "Player1, in $DIR")" \
    "open|$(t "Voir son adresse" "Show its address")|$ADDR" \
    "change|$(t "Changer ses réglages" "Change its settings")|$(t "port, adresse, dossiers" "port, address, folders")" \
    "restart|$(t "Le redémarrer" "Restart it")|" \
    "log|$(t "Voir ce qu'il fait" "See what it is doing")|$(t "les dernières lignes de son journal" "the last lines of its log")" \
    "remove|$(t "L'enlever de cette machine" "Remove it from this machine")|" \
    "quit|$(t "Rien, quitter" "Nothing, quit")|"
  _p=""; ! grep -q '^PUID=' .env || { _p=$(project_of "$DIR"); [ -n "$_p" ] || _p=stopped; }
  case "$DO$_p" in restartstopped|logstopped) die "Il ne tourne pas. Choisis « Changer ses réglages » pour le relancer." "It isn't running. Choose “Change its settings” to start it again." ;; esac
  case "$DO" in
    change) CHANGE=1; cd /; return 0 ;;
    remove) uninstall "$DIR" ;;
    open) _t=$(sed -n 's/.*"SETUP_TOKEN": *"\([0-9a-f]*\)".*/\1/p' data/config.json 2>/dev/null || true)
      if [ -n "$_t" ]; then outro "Son installation n'est pas terminée. Ouvre ce lien dans ton navigateur :" "Its setup isn't finished. Open this link in your browser:" "$ADDR/?setup=$_t"
      else outro "Player1 s'ouvre à cette adresse :" "Player1 opens at this address:" "$ADDR"; fi ;;
    restart)
      if [ -n "$_p" ]; then step "$(t "Redémarrage de Player1" "Restarting Player1")" docker compose -p "$_p" restart || failed "Docker n'a pas pu le redémarrer." "Docker couldn't restart it."
      elif [ -f /etc/systemd/system/player1.service ]; then need_root; $SUDO systemctl restart player1; ok "Player1 a redémarré" "Player1 restarted"
      else systemctl --user restart player1; ok "Player1 a redémarré" "Player1 restarted"; fi ;;
    log)
      if [ -n "$_p" ]; then docker compose -p "$_p" logs --tail 40 --no-log-prefix 2>&1 || true
      elif [ -f /etc/systemd/system/player1.service ]; then journalctl -u player1 -n 40 --no-pager || true
      else journalctl --user -u player1 -n 40 --no-pager || true; fi ;;
  esac
  exit 0
}
uninstall() { # uninstall [<folder>]
  D="$HOME/player1"; [ ! -f ./run.mjs ] || [ ! -f ./.env ] || D=$(pwd)
  DIR=${1:-}
  while [ -z "$DIR" ]; do
    ask DIR "$D" "Dossier de l'installation à enlever" "Folder of the install to remove"
    [ -f "$DIR/run.mjs" ] && [ -f "$DIR/.env" ] && break
    retry "Player1 n'est pas installé dans $DIR." "Player1 isn't installed in $DIR."; DIR=""
  done
  cd "$DIR"; DIR=$(pwd)
  # what this install put on the machine, found again from its folder: only that is removed
  URL=$(sed -n 's/^PUBLIC_URL=//p' .env | head -1); HOST=${URL#*://}; HOST=${HOST%%[:/]*}
  PORT=$(sed -n 's/^PORT=//p' .env | head -1)
  PROJ=""; ! have docker || PROJ=$(project_of "$DIR")
  UNITS=$(grep -ls -e "=$DIR\$" -e "$DIR/" /etc/systemd/system/player1.service /etc/systemd/system/player1-caddy.service 2>/dev/null | xargs -r -n1 basename | tr '\n' ' ')
  UUNIT="$HOME/.config/systemd/user/player1.service"; grep -qs "^WorkingDirectory=$DIR\$" "$UUNIT" || UUNIT=""
  [ -n "$PORT" ] || PORT=$(sed -n 's/^Environment=PORT=\([0-9]*\).*/\1/p' /etc/systemd/system/player1.service "$UUNIT" 2>/dev/null | head -1)
  SITE=""
  if [ -n "$HOST" ]; then
    for f in /etc/apache2/sites-available/player1.conf /etc/httpd/conf.d/player1.conf; do ! grep -qs "ServerName $HOST\$" "$f" || SITE=apache; done
    for f in /etc/nginx/sites-available/player1 /etc/nginx/conf.d/player1.conf; do ! grep -qs "server_name $HOST;" "$f" || SITE=nginx; done
    ! grep -qs "^$HOST {\$" /etc/caddy/Caddyfile || SITE=caddy
  fi
  TS=""; case "$HOST" in *.ts.net) ! tailscale serve status 2>/dev/null | grep -q "http://127.0.0.1:$PORT\$" || { TS=443; case "$URL" in *:8443) TS=8443 ;; esac; } ;; esac

  say "Ce qui sera enlevé de cette machine :" "What will be removed from this machine:"
  [ -z "$PROJ" ] || say "  - le conteneur Docker de $DIR" "  - the Docker container of $DIR"
  [ -z "$UNITS$UUNIT" ] || say "  - le service de Player1" "  - Player1's service"
  case "$SITE" in apache) IN=Apache ;; nginx) IN=Nginx ;; *) IN=Caddy ;; esac
  [ -z "$SITE" ] || say "  - le site $HOST dans $IN, et son certificat" "  - the site $HOST in $IN, and its certificate"
  [ -z "$TS" ] || say "  - $URL sur ton réseau Tailscale" "  - $URL on your Tailscale network"
  [ -n "$PROJ$UNITS$UUNIT$SITE$TS" ] || say "  - rien ne tourne pour ce dossier" "  - nothing is running for this folder"
  printf '%s\n' "$G"
  pick WHAT "$(t "Enlever cette installation ?" "Remove this install?")" \
    "no|$(t "Non, ne rien toucher" "No, leave everything")|" \
    "keep|$(t "Oui, mais garder mes données" "Yes, but keep my data")|$(t "réglages, profils, progression : le dossier reste" "settings, profiles, progress: the folder stays")" \
    "all|$(t "Oui, tout enlever" "Yes, remove everything")|$(t "le dossier $DIR est supprimé" "the folder $DIR is deleted")"
  [ "$WHAT" != no ] || { printf '%s\n\n' "$cV$sEND$c0  $(t "Rien n'a été touché." "Nothing was touched.")"; return 0; }
  forget "$DIR"
  [ -z "$UNITS$SITE$TS" ] || need_root

  [ -z "$PROJ" ] || step "$(t "Arrêt du conteneur" "Stopping the container")" docker compose -p "$PROJ" --profile caddy down -v --rmi local || failed "Docker n'a pas pu l'arrêter." "Docker couldn't stop it."
  if [ -n "$UNITS" ]; then
    for u in $UNITS; do $SUDO systemctl disable --now "$u" >/dev/null 2>&1 || true; $SUDO rm -f "/etc/systemd/system/$u"; done; $SUDO systemctl daemon-reload
  fi
  [ -z "$UUNIT" ] || { systemctl --user disable --now player1 >/dev/null 2>&1 || true; rm -f "$UUNIT"; systemctl --user daemon-reload; }
  [ -z "$UNITS$UUNIT" ] || ok "Service enlevé" "Service removed"
  case "$SITE" in
    apache) ! have a2dissite || $SUDO a2dissite -q player1 player1-le-ssl >/dev/null 2>&1 || true
      $SUDO rm -f /etc/apache2/sites-available/player1.conf /etc/apache2/sites-available/player1-le-ssl.conf /etc/httpd/conf.d/player1.conf /etc/httpd/conf.d/player1-le-ssl.conf
      $SUDO apachectl configtest 2>/dev/null && { $SUDO systemctl reload apache2 2>/dev/null || $SUDO systemctl reload httpd; } ;;
    nginx) $SUDO rm -f /etc/nginx/sites-enabled/player1 /etc/nginx/sites-available/player1 /etc/nginx/conf.d/player1.conf
      $SUDO nginx -t 2>/dev/null && $SUDO systemctl reload nginx ;;
    caddy) $SUDO sed -i "/^$HOST {\$/,/^}\$/d" /etc/caddy/Caddyfile; $SUDO systemctl reload caddy ;;
  esac
  if [ -n "$SITE" ]; then
    [ "$SITE" = caddy ] || ! have certbot || ! $SUDO test -d "/etc/letsencrypt/live/$HOST" || $SUDO certbot delete -n --cert-name "$HOST" >/dev/null 2>&1 || true
    ok "Site $HOST enlevé" "Site $HOST removed"
  fi
  [ -z "$TS" ] || { $SUDO tailscale serve --https="$TS" off >/dev/null 2>&1 || true; ok "Enlevé de ton réseau Tailscale" "Removed from your Tailscale network"; }
  if [ "$WHAT" = all ]; then cd /; rm -rf "$DIR" || die "$DIR n'a pas pu être supprimé en entier" "$DIR couldn't be deleted entirely"; ok "Dossier $DIR supprimé" "Folder $DIR deleted"; fi
  printf '%s\n' "$G"; outro "Player1 est enlevé de cette machine." "Player1 is removed from this machine."
  [ "$WHAT" != keep ] || printf '   %s\n\n' "$(t "Tes données sont dans $DIR/data. Relance l'installation dans ce dossier pour les retrouver." "Your data is in $DIR/data. Run the installer on this folder again to get it back.")"
}

# --- the questions ---
printf '\n%s\n%s\n' "$cV$sTOP$c0  $cY${cB}Player1$c0" "$G"
L=; [ "${1:-}" != menu ] || L=$(cat "$REG.lang" 2>/dev/null || true) # the command speaks the language chosen at install
[ -n "$L" ] || { if [ -n "$FR" ]; then pick L "Langue" "fr|Français|" "en|English|"; else pick L "Language" "en|English|" "fr|Français|"; fi; }
FR=; [ "$L" != fr ] || FR=1
# Player1 is already here: its menu first (the "player1" command comes straight to it)
CHANGE=; FOUND=$(installs); HOW=${1:-install}
[ "$HOW" != uninstall ] || { uninstall; exit 0; }
[ "$HOW" != menu ] || [ -n "$FOUND" ] || die "Player1 n'est plus installé sur cette machine." "Player1 isn't installed on this machine any more."
if [ -n "$FOUND" ]; then
  _ifs=$IFS; IFS=$NL; set -- $FOUND; IFS=$_ifs
  if [ "$HOW" = menu ] && [ $# = 1 ]; then menu "$1"
  else
    for _d; do set -- "$@" "$_d|$_d|$(address_of "$_d")"; shift; done
    [ "$HOW" = menu ] || set -- "$@" "new|$(t "Installer un autre Player1" "Install another Player1")|"
    pick DIR "$(t "Player1 est déjà sur cette machine" "Player1 is already on this machine")" "$@"
    [ "$DIR" = new ] || menu "$DIR"
  fi
fi
have git || die "git est nécessaire (apt install git)" "git is required (apt install git)"

P_REACH=; P_DOMAIN=; P_MEDIA=; P_QBIT=
if [ -n "$CHANGE" ]; then # the same questions, starting from this install's answers
  MODE=bare; ! grep -q '^PUID=' "$DIR/.env" || MODE=docker
  P_MEDIA=$(sed -n 's/^MEDIA_DIR=//p' "$DIR/.env" | head -1); P_QBIT=$(sed -n 's/^QBIT_FILES=//p' "$DIR/.env" | head -1)
  P_DOMAIN=$(sed -n 's/^PUBLIC_URL=//p' "$DIR/.env" | head -1); P_DOMAIN=${P_DOMAIN#*://}; P_DOMAIN=${P_DOMAIN%%[:/]*}
  case "$P_DOMAIN" in '') P_REACH=1 ;; *.ts.net) P_REACH=3; P_DOMAIN= ;; *) P_REACH=2 ;; esac
else
  if have docker && docker compose version >/dev/null 2>&1; then
    pick MODE "$(t "Comment faire tourner Player1 ?" "How should Player1 run?")" \
      "docker|Docker|$(t "recommandé : il est déjà sur cette machine" "recommended: it is already on this machine")" \
      "bare|$(t "Sans Docker" "Without Docker")|$(t "un service de cette machine (systemd)" "a service of this machine (systemd)")"
  else MODE=bare; have systemctl || die "il faut Docker ou systemd sur cette machine" "this machine needs Docker or systemd"; fi
  ask DIR "$HOME/player1" "Dossier d'installation" "Install folder"
fi
# the port: the one this install already has, else the first free one from 6510
WAS=$(port_of "$DIR")
PORT=${WAS:-6510}; while [ -z "$WAS" ] && listening "$PORT"; do PORT=$((PORT + 1)); done
FREE=$PORT
while :; do
  ask PORT "$FREE" "Port" "Port"
  case "$PORT" in ''|*[!0-9]*) retry "Un port est un nombre." "A port is a number."; continue ;; esac
  [ "$PORT" != "$WAS" ] && listening "$PORT" || break
  retry "Le port $PORT est déjà pris sur cette machine." "Port $PORT is already taken on this machine."
done
PICK=$P_REACH
pick REACH "$(t "Comment veux-tu ouvrir Player1 ?" "How do you want to open Player1?")" \
  "1|$(t "À la maison seulement" "At home only")|$(t "sur ton réseau" "on your own network")" \
  "2|$(t "De partout, avec ton nom de domaine" "From anywhere, with your domain name")|$(t "le HTTPS s'installe tout seul" "HTTPS sets itself up")" \
  "3|$(t "De partout, avec Tailscale" "From anywhere, with Tailscale")|$(t "sans nom de domaine, gratuit" "no domain name needed, free")"
DOMAIN=""; FRONT=""; URL=""; BIND=127.0.0.1; [ "$REACH" != 1 ] || BIND=0.0.0.0
while [ "$REACH" = 2 ] && [ -z "$DOMAIN" ]; do
  if [ -n "$P_DOMAIN" ]; then ask DOMAIN "$P_DOMAIN" "Ton nom de domaine" "Your domain name"
  else ask DOMAIN "" "Ton nom de domaine" "Your domain name" "par exemple player.exemple.fr" "for example player.example.com"; fi
  DOMAIN=$(printf %s "$DOMAIN" | sed 's#^[A-Za-z]*://##; s#/.*##' | tr 'A-Z' 'a-z')
  case "$DOMAIN" in *[!a-z0-9.-]*|.*|*.|*..*) DOMAIN="" ;; *.*) ;; *) DOMAIN="" ;; esac
  [ -n "$DOMAIN" ] || retry "Ce n'est pas un nom de domaine. Par exemple : player.exemple.fr" "That isn't a domain name. For example: player.example.com"
done
folder() { # folder <var> <previous> <fr question> <en question>: a folder of this machine, or nothing
  while :; do
    if [ -n "$2" ]; then ask "$1" "$2" "$3" "$4" "Entrée pour garder $2. Tape - pour l'enlever." "Enter to keep $2. Type - to remove it."
    else ask "$1" "" "$3" "$4" "Son dossier, s'il est sur cette machine. Entrée pour passer." "Its folder, if it is on this machine. Enter to skip."; fi
    eval "_d=\$$1"; [ "$_d" != - ] || { eval "$1="; break; }
    [ -n "$_d" ] && [ ! -d "$_d" ] || break
    retry "Ce dossier n'existe pas sur cette machine : $_d. Entrée pour passer." "This folder doesn't exist on this machine: $_d. Enter to skip."
  done
}
folder MEDIA "$P_MEDIA" "Bibliothèque Jellyfin" "Jellyfin library"
folder QBIT "$P_QBIT" "Téléchargements de qBittorrent" "qBittorrent's downloads"

# --- the code: a git checkout that run.mjs keeps up to date ---
if [ -d "$DIR/.git" ]; then step "$(t "Mise à jour du code" "Updating the code")" git -C "$DIR" pull --ff-only --quiet || warn "Code laissé tel quel : il a été modifié sur cette machine." "Code left as it is: it was changed on this machine."
else step "$(t "Téléchargement de Player1" "Downloading Player1")" git clone --quiet "$REPO" "$DIR" || failed "Le téléchargement a échoué." "The download failed."; fi
cd "$DIR"; DIR=$(pwd); mkdir -p data
[ -z "$MEDIA" ] || { mkdir -p "$MEDIA/player1" 2>/dev/null || $SUDO mkdir -p "$MEDIA/player1"; $SUDO chmod 777 "$MEDIA/player1" 2>/dev/null || true; }

# --- the address: everything this machine can do by itself, before the (long) first build ---
IP=$(hostname -I 2>/dev/null | cut -d' ' -f1); IP=${IP:-localhost}
OWN=data/caddy/Caddyfile # Player1's own Caddy, from this run or an earlier one
# Docker names a project after its folder: a second install, in another folder also called "player1", would be the
# same project and its start would replace the first one's container. So each install has a name of its own: the one
# it already has, else "player1" when nothing uses it, else "player1-<port>".
PROJ=$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' .env 2>/dev/null | head -1)
if [ "$MODE" = docker ] && [ -z "$PROJ" ]; then
  PROJ=$(project_of "$DIR")
  if [ -z "$PROJ" ]; then PROJ=player1; [ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$PROJ")" ] || PROJ="player1-$PORT"; fi
fi
case "$REACH" in
  1) LINK="http://$IP:$PORT"; open_ports "$PORT" ;;
  2) URL="https://$DOMAIN"; LINK=$URL
     if [ -f "$OWN" ]; then FRONT=own; else FRONT=$(web_server); FRONT=${FRONT:-own}; fi
     check_dns
     if [ "$FRONT" = other ]; then BIND=0.0.0.0; LINK="http://$IP:$PORT"
       warn "Un autre serveur web occupe déjà les ports 80 et 443 de cette machine. Ajoute-lui ce site : $DOMAIN, en HTTPS, vers http://$IP:$PORT" \
         "Another web server already holds ports 80 and 443 on this machine. Add this site to it: $DOMAIN, in HTTPS, to http://$IP:$PORT"
     else [ "$FRONT$MODE" = owndocker ] || need_root; "front_$FRONT"; fi ;;
  3) need_root; front_tailscale; LINK=$URL ;;
esac
if [ "$FRONT" != own ] && [ -f "$OWN" ]; then # an earlier run's Caddy, no longer wanted
  rm -f "$OWN"
  if [ "$MODE" = docker ]; then docker compose -p "$PROJ" --profile caddy rm -sf caddy >/dev/null 2>&1 || true
  else $SUDO systemctl disable --now player1-caddy >/dev/null 2>&1 || true; fi
fi

if [ "$MODE" = docker ]; then
  { echo "# written by install.sh"; echo "COMPOSE_PROJECT_NAME=$PROJ"; echo "PUID=$(id -u)"; echo "PGID=$(id -g)"; echo "PORT=$PORT"; echo "BIND=$BIND"
    [ -z "$URL" ] || echo "PUBLIC_URL=$URL"; [ "$FRONT" != own ] || echo "COMPOSE_PROFILES=caddy"
    [ -z "$MEDIA" ] || echo "MEDIA_DIR=$MEDIA"; [ -z "$QBIT" ] || echo "QBIT_FILES=$QBIT"; } > .env
  { echo "# written by install.sh: folders mounted at the same path inside the container"
    echo "services:"; echo "  player1:"; if [ -z "$MEDIA$QBIT" ]; then echo "    volumes: []"; else echo "    volumes:"; fi
    [ -z "$MEDIA" ] || { echo "      - \"$MEDIA:$MEDIA:ro\""; echo "      - \"$MEDIA/player1:$MEDIA/player1\""; }
    [ -z "$QBIT" ] || echo "      - \"$QBIT:$QBIT:ro\""; } > compose.override.yml
  step "$(t "Démarrage de Player1 dans Docker" "Starting Player1 in Docker")" docker compose up -d --build || failed "Docker n'a pas pu démarrer Player1." "Docker couldn't start Player1."
else
  # Node: this machine's if recent enough, else the official build in data/runtime (checksum checked)
  NODE=$(command -v node || true)
  if [ -z "$NODE" ] || [ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
    have curl || die "curl est nécessaire" "curl is required"; have xz || die "xz est nécessaire (apt install xz-utils)" "xz is required (apt install xz-utils)"
    NV="v$(sed -n 's/^[[:space:]]*"node": "\([0-9.]*\)".*/\1/p' package.json)"; NN="node-$NV-linux-$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')"; NODE="$DIR/data/runtime/$NN/bin/node"
    get_node() {
      mkdir -p data/runtime && cd data/runtime
      curl -fsSLO "https://nodejs.org/dist/$NV/$NN.tar.xz" && curl -fsSL "https://nodejs.org/dist/$NV/SHASUMS256.txt" | grep " $NN.tar.xz\$" | sha256sum -c - >/dev/null
      tar -xJf "$NN.tar.xz" && rm "$NN.tar.xz"
    }
    [ -x "$NODE" ] || step "$(t "Téléchargement de Node" "Downloading Node")" get_node || failed "Le téléchargement de Node a échoué, ou n'est pas le bon fichier." "Node's download failed, or isn't the right file."
  fi
  have ffprobe || warn "ffprobe manque (apt install ffmpeg) : les fichiers de ta bibliothèque ne pourront pas être lus." "ffprobe is missing (apt install ffmpeg): your library's files can't be read."
  { echo "# written by install.sh"; [ -z "$URL" ] || echo "PUBLIC_URL=$URL"; [ -z "$MEDIA" ] || echo "MEDIA_DIR=$MEDIA"; [ -z "$QBIT" ] || echo "QBIT_FILES=$QBIT"; } > .env
  UNIT="[Unit]
Description=Player1
After=network-online.target
[Service]
WorkingDirectory=$DIR
EnvironmentFile=$DIR/.env
Environment=PORT=$PORT HOST=$BIND
ExecStart=$NODE run.mjs
Restart=always
RestartSec=2"
  if [ -n "$SUDO" ] || [ "$(id -u)" = 0 ]; then
    auth; printf '%s\nUser=%s\n[Install]\nWantedBy=multi-user.target\n' "$UNIT" "$(id -un)" | $SUDO tee /etc/systemd/system/player1.service >/dev/null
    $SUDO systemctl daemon-reload && $SUDO systemctl enable --now player1 2>/dev/null && $SUDO systemctl restart player1
  else
    mkdir -p "$HOME/.config/systemd/user"; printf '%s\n[Install]\nWantedBy=default.target\n' "$UNIT" > "$HOME/.config/systemd/user/player1.service"
    systemctl --user daemon-reload && systemctl --user enable --now player1 2>/dev/null && systemctl --user restart player1
    loginctl enable-linger "$(id -un)" 2>/dev/null || warn "Pour qu'il démarre sans session ouverte : sudo loginctl enable-linger $(id -un)" "To start without a login session: sudo loginctl enable-linger $(id -un)"
  fi
  ok "Player1 est un service de cette machine" "Player1 is a service of this machine"
fi

# --- the link to finish in the browser ---
# the first start builds the app (a few minutes on a small server), then the server writes the link
built() { for _ in $(seq 600); do grep -q SETUP_TOKEN data/config.json 2>/dev/null && return; [ -s data/app/server.mjs ] && [ -s data/config.json ] && return; sleep 1; done; return 1; }
if [ "$MODE" = docker ]; then SEE="cd $DIR && docker compose logs -f"; else SEE="journalctl -u player1 -f"; fi
step "$(t "Construction de Player1 (quelques minutes la première fois)" "Building Player1 (a few minutes the first time)")" built \
  || warn "Toujours pas prêt après 10 minutes. Pour voir où il en est : $SEE" "Still not ready after 10 minutes. To see where it is: $SEE"
if [ "$REACH" = 2 ] && [ "$FRONT" != other ]; then
  # asked on this machine itself, so a router that can't loop back doesn't matter: a valid certificate means the
  # outside world reached Player1 to deliver it
  https_ok() { n=0; until curl -fsS --max-time 8 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/setup" 2>/dev/null | grep -q needed; do n=$((n + 1)); [ "$n" -lt 45 ] || return 1; sleep 2; done; }
  if ! step "https://$DOMAIN" https_ok; then
    say "Il ne répond pas encore. Le plus souvent :" "It doesn't answer yet. Most often:"
    say "  - le nom de domaine ne pointe pas (ou pas encore) vers cette machine" "  - the domain name doesn't point to this machine (or not yet)"
    say "  - les ports 80 et 443 n'arrivent pas jusqu'à elle : redirection sur ta box, pare-feu de ton hébergeur" "  - ports 80 and 443 don't get to it: forwarding on your router, your host's firewall"
    if [ "$FRONT" = apache ] || [ "$FRONT" = nginx ]; then say "Une fois réglé, relance cette installation." "Once that's sorted, run this installer again."
    else say "Rien à relancer : le certificat est redemandé tout seul, et le lien ci-dessous marchera dès que c'est réglé." "Nothing to run again: the certificate is asked for again by itself, and the link below will work once that's sorted."; fi
  fi
fi
TOKEN=$(sed -n 's/.*"SETUP_TOKEN": *"\([0-9a-f]*\)".*/\1/p' data/config.json 2>/dev/null || true)
[ -z "$TOKEN" ] || LINK="$LINK/?setup=$TOKEN"
remember "$DIR"; printf '%s\n' "$G"
if [ -n "$TOKEN" ]; then outro "Player1 tourne. Termine l'installation dans ton navigateur :" "Player1 is running. Finish the setup in your browser:" "$LINK"
else outro "Player1 tourne. Il s'ouvre à cette adresse :" "Player1 is running. It opens at this address:" "$LINK"; fi
[ "$REACH" != 3 ] || printf '   %s\n\n' "$(t "Sur chaque appareil (téléphone, télé, ordinateur) : installe Tailscale et connecte-toi au même compte." "On each device (phone, TV, computer): install Tailscale and sign in to the same account.")"
printf '   %s\n\n' "$(t "Pour voir son adresse, changer ces réglages ou l'enlever plus tard, tape :" "To see its address, change these settings or remove it later, type:") $cB$CALL$c0"
