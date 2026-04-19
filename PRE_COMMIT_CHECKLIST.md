# 🔒 Pre-Commit Security Checklist

**Use this checklist EVERY TIME before committing code!**

This ensures you never accidentally expose sensitive deployment information.

---

## ⚡ Quick Check (30 seconds)

Run these commands before EVERY commit:

```bash
# 1. What am I about to commit?
git status

# 2. Are any sensitive files staged?
git diff --cached --name-only | grep -E "\.env$|\.service$|nginx\.conf$|\.setup-config$|\.key$|\.pem$"

# 3. Do my changes contain secrets?
git diff --cached | grep -i -E "jwt_secret|password|api_key|secret_key|ssu\.ac\.kr"
```

**If any command shows results, STOP and review!**

---

## 📋 Full Checklist

### Before `git add`:

- [ ] I have NOT modified any `.env` files (use `.env.example` instead)
- [ ] I have NOT created any new configuration files with real values
- [ ] I have NOT added any SSH keys or certificates
- [ ] I have NOT added any database files

### Before `git commit`:

- [ ] Run `git status` - review ALL staged files
- [ ] Run `git diff --cached` - review ALL changes
- [ ] No `.env` files are staged
- [ ] No `nginx.conf` is staged
- [ ] No `*.service` files are staged
- [ ] No `.setup-config` is staged
- [ ] No SSH keys (`*.key`, `*_rsa*`, `*_ed25519*`)
- [ ] No certificates (`*.pem`, `*.crt`)
- [ ] No database files (`*.db`, `*.sqlite`)

### Code Review:

- [ ] No hardcoded domains (use `example.com` for examples)
- [ ] No hardcoded IP addresses (unless generic examples)
- [ ] No hardcoded credentials
- [ ] No hardcoded JWT secrets
- [ ] No real hostnames (dilab.ssu.ac.kr, etc.)
- [ ] All examples use placeholders

### Documentation Review:

- [ ] Examples use generic domains (`example.com`, `localhost`)
- [ ] No real deployment URLs
- [ ] No specific server names
- [ ] Instructions are generic and reusable

---

## 🚨 Common Mistakes

### ❌ DON'T Commit:

```bash
# Environment files
backend/.env
frontend/.env

# Generated configs
nginx.conf
node-monitor.service
.setup-config

# SSH keys
~/.ssh/node_monitor
~/.ssh/node_monitor.pub
*.key
*.pem

# Databases
backend/data/
*.db

# Deployment-specific docs
CURRENT_DEPLOYMENT.md
```

### ✅ DO Commit:

```bash
# Source code
backend/src/**/*.js
frontend/src/**/*.jsx

# Examples and templates
backend/.env.example
nginx.conf.example
templates/*.template

# Documentation (generic)
README.md
SETUP_GUIDE.md

# Setup scripts
setup.sh
deploy.sh (if generic)
```

---

## 🔍 Detailed Checks

### 1. Environment Variables

```bash
# Check if .env is staged
git diff --cached --name-only | grep "\.env$"

# Should return NOTHING
# If it returns .env, run:
git reset HEAD backend/.env frontend/.env
```

**Rules:**
- ✅ Modify `.env.example` (safe)
- ✅ Modify `templates/.env.template` (safe)
- ❌ Never commit `.env` files

### 2. Configuration Files

```bash
# Check for configs
git diff --cached --name-only | grep -E "nginx\.conf$|\.service$|\.setup-config$"

# Should return NOTHING
```

**Rules:**
- ✅ Commit `nginx.conf.example`
- ✅ Commit `nginx.conf.filled-example`
- ✅ Commit `templates/nginx.conf.template`
- ❌ Never commit `nginx.conf` (generated)
- ❌ Never commit `*.service` (generated)

### 3. Secrets & Keys

```bash
# Search for hardcoded secrets
git diff --cached | grep -i -E "jwt_secret.*=.*[a-zA-Z0-9]{20,}"

# Should return NOTHING
```

**Rules:**
- ✅ `JWT_SECRET={{JWT_SECRET}}` (template)
- ✅ `JWT_SECRET=change-me...` (example)
- ❌ `JWT_SECRET=v9Lk3JqM8xR2pY...` (real secret!)

### 4. Domains & IPs

```bash
# Search for specific domains
git diff --cached | grep -E "ssu\.ac\.kr|dilab\.|[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}"

# Should ONLY show example.com, localhost, or templates
```

**Rules:**
- ✅ `example.com`
- ✅ `your-domain.com`
- ✅ `localhost`
- ✅ `{{DOMAIN_NAME}}`
- ❌ `dilab.ssu.ac.kr`
- ❌ `192.168.1.100` (unless clearly an example)

---

## 🛠️ Fix Common Issues

### Issue: .env file is staged

```bash
# Remove from staging
git reset HEAD backend/.env

# Verify it's in .gitignore
git check-ignore -v backend/.env
# Should output: .gitignore:69:.env	backend/.env
```

### Issue: nginx.conf is staged

```bash
# Remove from staging
git reset HEAD nginx.conf

# Remove from tracking (if needed)
git rm --cached nginx.conf

# Verify it's in .gitignore
git check-ignore -v nginx.conf
```

### Issue: Hardcoded domain in code

```bash
# Example: Found 'dilab.ssu.ac.kr' in code
# Replace with:
process.env.NODE1_HOST || 'node1.example.com'

# Or for documentation:
# Use: your-domain.com, example.com, or localhost
```

### Issue: JWT secret in code

```bash
# Never commit:
JWT_SECRET=v9Lk3JqM8xR2pY7zW1nB5cF6dH0gT4s...

# Always use:
JWT_SECRET=change-me-to-a-long-random-secret-at-least-64-chars
# or
JWT_SECRET={{JWT_SECRET}}
```

---

## 🎯 Safe Workflow

### Recommended Workflow:

```bash
# 1. Make changes to code
nano backend/src/myfeature.js

# 2. Test locally with your .env (not tracked)
npm run dev

# 3. Review what changed
git diff

# 4. Stage ONLY code files
git add backend/src/myfeature.js

# 5. RUN THIS CHECKLIST!

# 6. Review staged changes
git diff --cached

# 7. Commit
git commit -m "Add new feature"

# 8. Push
git push
```

### DON'T do this:

```bash
# ❌ NEVER do this!
git add .
git commit -m "update"
git push

# This can commit .env, nginx.conf, SSH keys, etc.!
```

---

## 📊 Automated Check Script

Create this script to automate checks:

```bash
#!/bin/bash
# save as: .git/hooks/pre-commit

echo "🔒 Running security checks..."

# Check for sensitive files
SENSITIVE=$(git diff --cached --name-only | grep -E "\.env$|\.service$|nginx\.conf$|\.setup-config$|\.key$|\.pem$|\.db$")

if [ -n "$SENSITIVE" ]; then
    echo "❌ ERROR: Attempting to commit sensitive files:"
    echo "$SENSITIVE"
    echo ""
    echo "Remove them with: git reset HEAD <file>"
    exit 1
fi

# Check for secrets in content
SECRETS=$(git diff --cached | grep -i -E "jwt_secret.*=.*[a-zA-Z0-9]{20,}|password.*=.*[a-zA-Z0-9]{8,}")

if [ -n "$SECRETS" ]; then
    echo "⚠️  WARNING: Potential secrets found in diff"
    echo "Review carefully before committing!"
    echo ""
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check for specific domains
DOMAINS=$(git diff --cached | grep -E "ssu\.ac\.kr")

if [ -n "$DOMAINS" ]; then
    echo "⚠️  WARNING: Found specific domains (ssu.ac.kr)"
    echo "Consider using example.com instead"
    echo ""
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "✅ Security checks passed!"
exit 0
```

**Install:**
```bash
chmod +x .git/hooks/pre-commit
```

---

## 🎓 Training: Spot the Issues

### Example 1:
```bash
git status
# modified:   backend/src/newfeature.js
# modified:   backend/.env
```

**Issue?** ❌ `.env` file is modified
**Fix:** `git reset HEAD backend/.env`

---

### Example 2:
```javascript
// In code:
const host = 'dilab.ssu.ac.kr';
```

**Issue?** ❌ Hardcoded domain
**Fix:** `const host = process.env.NODE1_HOST || 'node1.example.com';`

---

### Example 3:
```bash
git diff --cached
+JWT_SECRET=v9Lk3JqM8xR2pY7zW1nB5cF6dH0gT4sVjKlaPoIuUyTrEwQxZcNbMmAqSfDgHhJl
```

**Issue?** ❌ Real JWT secret
**Fix:** Use `JWT_SECRET=change-me-to-a-long-random-secret...`

---

### Example 4:
```bash
git add nginx.conf
```

**Issue?** ❌ Committing generated config
**Fix:** `git reset HEAD nginx.conf`
**Use instead:** `nginx.conf.example`

---

## ✅ Final Verification

Before pushing, run all these:

```bash
# 1. What's being pushed?
git log origin/main..HEAD --oneline

# 2. Review all changes
git diff origin/main..HEAD

# 3. Check for sensitive patterns
git diff origin/main..HEAD | grep -i -E "\.env|jwt_secret.*=.*[a-zA-Z0-9]{20,}|password.*=|ssu\.ac\.kr|\.key|\.pem"

# 4. List new files
git diff origin/main..HEAD --name-status | grep "^A"

# If all clear:
git push
```

---

## 🆘 Emergency: Already Committed Secrets

If you committed secrets but haven't pushed:

```bash
# Undo last commit (keep changes)
git reset HEAD~1

# Remove sensitive files
git reset HEAD backend/.env

# Commit again (without secrets)
git commit -m "Your message"
```

If already pushed - see SECURITY_AUDIT.md for recovery steps.

---

## 📝 Checklist Summary

Quick checklist for every commit:

```
□ Ran git status
□ Reviewed git diff --cached
□ No .env files
□ No generated configs (nginx.conf, *.service)
□ No SSH keys
□ No hardcoded secrets
□ No specific domains
□ Examples use placeholders
□ Ready to commit!
```

---

**Always review before committing. Better safe than sorry!** 🔒

See also: [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for comprehensive audit results.
