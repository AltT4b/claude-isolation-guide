# BAD — DO NOT USE THIS AS YOUR CLAUDE_ENV_FILE
# These completion scripts will silently break all Bash commands.

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # <-- THIS BREAKS EVERYTHING
