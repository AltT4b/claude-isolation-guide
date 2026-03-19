#!/bin/bash
# Run Claude Code in an isolated Docker container.
# Each flag is documented — remove what you don't need, but understand what you're removing.

docker run -it --rm \
  --name claude-sandbox \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  --tmpfs /home/claude/.npm:rw,size=128m \
  -v "$(pwd):/home/claude/project:rw" \
  -e ANTHROPIC_API_KEY \
  claude-sandbox

# --cap-drop=ALL                              Drop all Linux capabilities.
#                                             Containers start with a subset of caps by default.
#                                             Dropping all means no mount, no chown, no net_raw, etc.
#
# --security-opt=no-new-privileges            Prevent privilege escalation via setuid/setgid binaries.
#                                             Even if a setuid binary exists in the image, it can't
#                                             gain privileges beyond the container's current set.
#
# --read-only                                 Mount the root filesystem as read-only.
#                                             Nothing in the container can modify system files.
#                                             Combined with --tmpfs, gives writable scratch space
#                                             without persistent mutation risk.
#
# --tmpfs /tmp:rw,noexec,nosuid,size=256m     Writable /tmp for scratch files, but noexec prevents
#                                             executing binaries dropped there. nosuid blocks setuid.
#                                             Size-limited to prevent filling host memory.
#
# --tmpfs /home/claude/.npm:rw,size=128m      Writable npm cache directory. Without this, npm
#                                             operations fail on a read-only filesystem.
#
# -v "$(pwd):/home/claude/project:rw"         Mount the current directory as the project workspace.
#                                             This is bidirectional — Claude can read and write your
#                                             project files. That's the point, but be aware.
#
# -e ANTHROPIC_API_KEY                        Pass the API key from the host environment.
#                                             Never bake keys into the image. Never use --env-file
#                                             with a .env that gets committed.
