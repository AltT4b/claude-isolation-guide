# CLAUDE_ENV_FILE — sourced before every Bash command.
# ONLY add environment setup here. NEVER add shell completions.

# nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
# NO bash_completion here!

# sdkman
export SDKMAN_DIR="$HOME/.sdkman"
[[ -s "$SDKMAN_DIR/bin/sdkman-init.sh" ]] && source "$SDKMAN_DIR/bin/sdkman-init.sh"
# NO bash_completion.sh here!

# Custom project vars
export PROJECT_ENV=sandbox-testing
