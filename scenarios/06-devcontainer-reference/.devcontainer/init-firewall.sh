#!/bin/bash
# Container-level network firewall — iptables rules
# Run as root during container init (before dropping to non-root user)

# Default deny outbound
iptables -P OUTPUT DROP

# Allow loopback
iptables -A OUTPUT -o lo -j ACCEPT

# Allow established connections
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DNS
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# Allow Anthropic API
iptables -A OUTPUT -d api.anthropic.com -p tcp --dport 443 -j ACCEPT

echo "Firewall rules applied — outbound restricted to DNS + api.anthropic.com"
