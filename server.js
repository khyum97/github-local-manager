const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const PORT = 3000;
const CONFIG_FILE = path.join(__dirname, 'config.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res, filepath) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
}));

// Read config file
function readConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    const defaultConfig = { token: '', folders: {}, nicknames: {} };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    return defaultConfig;
  }
  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(content);
    config.folders = config.folders || {};
    config.nicknames = config.nicknames || {};
    return config;
  } catch (err) {
    return { token: '', folders: {}, nicknames: {} };
  }
}

// Write config file
function writeConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

// Helper to execute git command and capture output
function runGit(cwd, command) {
  return new Promise((resolve) => {
    // Run command using UTF-8 encoding
    exec(command, { cwd, env: { ...process.env, LANG: 'en_US.UTF-8' } }, (error, stdout, stderr) => {
      resolve({
        success: !error,
        code: error ? error.code : 0,
        cmd: command,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
}

// Helper to automatically inject Personal Access Token into remote git URL if missing
async function ensureAuthenticatedRemote(localPath) {
  const config = readConfig();
  if (!config.token) return;

  const isGit = fs.existsSync(path.join(localPath, '.git'));
  if (!isGit) return;

  const urlRes = await runGit(localPath, 'git remote get-url origin');
  if (urlRes.success && urlRes.stdout) {
    const currentUrl = urlRes.stdout.trim();
    if (currentUrl.startsWith('https://github.com/') && !currentUrl.includes(config.token)) {
      const authenticatedUrl = currentUrl.replace('https://github.com/', `https://x-access-token:${config.token}@github.com/`);
      await runGit(localPath, `git remote set-url origin "${authenticatedUrl}"`);
    }
  }
}

// Get config state
app.get('/api/config', async (req, res) => {
  const config = readConfig();
  if (!config.token) {
    return res.json({ authenticated: false, folders: config.folders, nicknames: config.nicknames });
  }

  // Validate token with GitHub API
  try {
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${config.token}`,
        'User-Agent': 'GitHub-Local-Manager'
      }
    });

    if (userRes.ok) {
      const userData = await userRes.json();
      return res.json({
        authenticated: true,
        user: {
          login: userData.login,
          avatar_url: userData.avatar_url,
          html_url: userData.html_url
        },
        folders: config.folders,
        nicknames: config.nicknames
      });
    } else {
      // Token expired or invalid
      config.token = '';
      writeConfig(config);
      return res.json({ authenticated: false, folders: config.folders, nicknames: config.nicknames });
    }
  } catch (err) {
    // Network error, but token might still be valid. Treat as logged out for safety or keep.
    return res.json({ authenticated: false, error: 'Network error checking token', folders: config.folders, nicknames: config.nicknames });
  }
});

// Login (Save PAT)
app.post('/api/login', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  try {
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'GitHub-Local-Manager'
      }
    });

    if (userRes.ok) {
      const userData = await userRes.json();
      const config = readConfig();
      config.token = token;
      writeConfig(config);

      return res.json({
        success: true,
        user: {
          login: userData.login,
          avatar_url: userData.avatar_url,
          html_url: userData.html_url
        }
      });
    } else {
      return res.status(401).json({ error: 'Invalid Personal Access Token' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Failed to verify token with GitHub: ' + err.message });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  const config = readConfig();
  config.token = '';
  writeConfig(config);
  res.json({ success: true });
});

// Fetch user's public and private repositories
app.get('/api/repos', async (req, res) => {
  const config = readConfig();
  if (!config.token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    let repos = [];
    let page = 1;
    let hasMore = true;

    // Fetch repositories (public and private, sorted by updated time)
    while (hasMore && page <= 5) { // Limit to 500 repos for safety
      const reposRes = await fetch(`https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated`, {
        headers: {
          'Authorization': `token ${config.token}`,
          'User-Agent': 'GitHub-Local-Manager'
        }
      });

      if (!reposRes.ok) {
        throw new Error(`GitHub API returned status ${reposRes.status}`);
      }

      const pageRepos = await reposRes.json();
      if (pageRepos.length === 0) {
        hasMore = false;
      } else {
        repos = repos.concat(pageRepos);
        if (pageRepos.length < 100) {
          hasMore = false;
        } else {
          page++;
        }
      }
    }

    // Filter properties we need
    const formattedRepos = repos.map(repo => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      private: repo.private,
      description: repo.description,
      html_url: repo.html_url,
      clone_url: repo.clone_url,
      ssh_url: repo.ssh_url,
      updated_at: repo.updated_at,
      default_branch: repo.default_branch
    }));

    res.json(formattedRepos);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch repositories: ' + err.message });
  }
});

// Open native Windows Folder Browser Dialog using PowerShell
app.post('/api/select-folder', (req, res) => {
  // PowerShell script that sets output encoding to UTF8 and opens folder dialog
  const psCommand = `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select Directory'; $f.ShowNewFolderButton = $true; if ($f.ShowDialog() -eq 'OK') { Write-Host $f.SelectedPath } else { Write-Host 'CANCEL' }"`;

  exec(psCommand, { encoding: 'utf-8' }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: 'Failed to open folder picker: ' + error.message });
    }
    const selectedPath = stdout.trim();
    if (selectedPath === 'CANCEL' || !selectedPath) {
      return res.json({ selectedPath: null });
    }
    res.json({ selectedPath });
  });
});

// Map a local folder to a repository manually
app.post('/api/connect-folder', (req, res) => {
  const { repoFullName, localPath } = req.body;
  if (!repoFullName || !localPath) {
    return res.status(400).json({ error: 'Repository name and local path are required' });
  }

  const config = readConfig();
  config.folders[repoFullName] = localPath;
  writeConfig(config);
  res.json({ success: true, folders: config.folders });
});

// Unmap a local folder
app.post('/api/disconnect-folder', (req, res) => {
  const { repoFullName } = req.body;
  if (!repoFullName) {
    return res.status(400).json({ error: 'Repository name is required' });
  }

  const config = readConfig();
  delete config.folders[repoFullName];
  writeConfig(config);
  res.json({ success: true, folders: config.folders });
});

// Set a repository nickname
app.post('/api/set-nickname', (req, res) => {
  const { repoFullName, nickname } = req.body;
  if (!repoFullName) {
    return res.status(400).json({ error: 'Repository name is required' });
  }

  const config = readConfig();
  if (nickname && nickname.trim()) {
    config.nicknames[repoFullName] = nickname.trim();
  } else {
    delete config.nicknames[repoFullName];
  }
  writeConfig(config);
  res.json({ success: true, nicknames: config.nicknames });
});

// Get Git status of a local directory
app.post('/api/git-status', async (req, res) => {
  const { localPath, repoFullName } = req.body;
  if (!localPath || !fs.existsSync(localPath)) {
    return res.status(400).json({ error: 'Valid local path is required' });
  }

  await ensureAuthenticatedRemote(localPath);

  const logs = [];

  // Check if it's a git repository
  const isGit = fs.existsSync(path.join(localPath, '.git'));
  if (!isGit) {
    return res.json({ isGit: false });
  }

  // Get current branch
  const branchRes = await runGit(localPath, 'git branch --show-current');
  logs.push(branchRes);
  const branch = branchRes.stdout || 'unknown';

  // Fetch from origin to check differences
  const fetchRes = await runGit(localPath, 'git fetch origin');
  logs.push(fetchRes);

  // Check uncommitted changes
  const statusRes = await runGit(localPath, 'git status --porcelain');
  logs.push(statusRes);
  const changedFiles = statusRes.stdout ? statusRes.stdout.split('\n').filter(Boolean) : [];

  // Check ahead/behind count vs origin
  let ahead = 0;
  let behind = 0;
  let diverged = false;
  let remoteExists = false;

  // Check if remote tracking branch exists
  const remoteBranchCheck = await runGit(localPath, `git rev-parse --verify origin/${branch}`);
  logs.push(remoteBranchCheck);

  if (remoteBranchCheck.success) {
    remoteExists = true;
    const aheadRes = await runGit(localPath, `git rev-list --count origin/${branch}..HEAD`);
    const behindRes = await runGit(localPath, `git rev-list --count HEAD..origin/${branch}`);
    logs.push(aheadRes);
    logs.push(behindRes);

    ahead = parseInt(aheadRes.stdout, 10) || 0;
    behind = parseInt(behindRes.stdout, 10) || 0;
    diverged = ahead > 0 && behind > 0;
  }

  res.json({
    isGit: true,
    branch,
    changedFiles,
    ahead,
    behind,
    diverged,
    remoteExists,
    logs
  });
});

// Clone a repository
app.post('/api/git-clone', async (req, res) => {
  const { cloneUrl, localPath, repoFullName } = req.body;
  const config = readConfig();
  if (!config.token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!cloneUrl || !localPath) {
    return res.status(400).json({ error: 'Clone URL and local path are required' });
  }

  // Ensure target folder exists or parent folder exists
  const targetFolder = path.resolve(localPath);
  
  // Inject Personal Access Token into clone URL to authenticate private repos
  // https://<token>@github.com/owner/repo.git
  const authenticatedUrl = cloneUrl.replace('https://', `https://x-access-token:${config.token}@`);

  const logs = [];
  const cloneCmd = `git clone "${authenticatedUrl}" "${targetFolder}"`;
  
  // Execute clone
  const cloneRes = await runGit(null, cloneCmd);
  
  // Mask the token in the log cmd for security
  cloneRes.cmd = cloneCmd.replace(config.token, '***TOKEN***');
  logs.push(cloneRes);

  if (cloneRes.success) {
    // Map folder automatically in config
    config.folders[repoFullName] = targetFolder;
    writeConfig(config);
    
    // Set custom username/email config local if needed or just use global
    // Let's do a simple config just in case, but usually global works.
    
    return res.json({ success: true, localPath: targetFolder, logs });
  } else {
    return res.status(500).json({ error: 'Git Clone failed', logs });
  }
});

// Pull changes
app.post('/api/git-pull', async (req, res) => {
  const { localPath } = req.body;
  if (!localPath || !fs.existsSync(localPath)) {
    return res.status(400).json({ error: 'Valid local path is required' });
  }

  await ensureAuthenticatedRemote(localPath);
  const logs = [];
  // Run git pull
  const pullRes = await runGit(localPath, 'git pull');
  logs.push(pullRes);

  if (pullRes.success) {
    res.json({ success: true, logs });
  } else {
    res.status(500).json({ error: 'Git Pull failed', logs });
  }
});

// Push changes (including auto-commit if there are changes)
app.post('/api/git-push', async (req, res) => {
  const { localPath, autoCommit, commitMessage } = req.body;
  if (!localPath || !fs.existsSync(localPath)) {
    return res.status(400).json({ error: 'Valid local path is required' });
  }

  await ensureAuthenticatedRemote(localPath);
  const logs = [];

  // Check if there are changes
  const statusRes = await runGit(localPath, 'git status --porcelain');
  logs.push(statusRes);
  const hasChanges = !!statusRes.stdout.trim();

  if (hasChanges && (autoCommit || commitMessage)) {
    // Stage all changes
    const addRes = await runGit(localPath, 'git add .');
    logs.push(addRes);

    // Commit changes
    const msg = commitMessage || `Auto-update: ${new Date().toISOString().replace('T', ' ').substring(0, 19)}`;
    const commitRes = await runGit(localPath, `git commit -m "${msg.replace(/"/g, '\\"')}"`);
    logs.push(commitRes);

    if (!commitRes.success) {
      return res.status(500).json({ error: 'Git Commit failed', logs });
    }
  }

  // Get current branch to push with upstream configuration
  const branchRes = await runGit(localPath, 'git branch --show-current');
  const branch = branchRes.stdout || 'master';

  // Run git push -u origin <branch> to configure remote tracking branch automatically
  const pushRes = await runGit(localPath, `git push -u origin ${branch}`);
  logs.push(pushRes);

  if (pushRes.success) {
    res.json({ success: true, logs });
  } else {
    res.status(500).json({ error: 'Git Push failed. Check if remote branch is ahead (diverged). You may need to pull or reconcile.', logs });
  }
});

// Reconcile/Merge diverged branches
app.post('/api/git-reconcile', async (req, res) => {
  const { localPath, mode, branch } = req.body;
  if (!localPath || !fs.existsSync(localPath)) {
    return res.status(400).json({ error: 'Valid local path is required' });
  }
  if (!mode || !branch) {
    return res.status(400).json({ error: 'Mode and branch name are required' });
  }

  await ensureAuthenticatedRemote(localPath);
  const logs = [];
  let success = false;
  let errorMsg = '';

  if (mode === 'merge') {
    // git merge origin/branch
    const mergeRes = await runGit(localPath, `git merge origin/${branch}`);
    logs.push(mergeRes);
    success = mergeRes.success;
    if (!success) errorMsg = 'Merge conflict occurred. You will need to resolve conflicts manually in your code editor.';
  } else if (mode === 'rebase') {
    // git rebase origin/branch
    const rebaseRes = await runGit(localPath, `git rebase origin/${branch}`);
    logs.push(rebaseRes);
    success = rebaseRes.success;
    if (!success) errorMsg = 'Rebase conflict occurred. You may need to abort rebase via git rebase --abort.';
  } else if (mode === 'force-push') {
    // git push origin branch --force
    const pushRes = await runGit(localPath, `git push origin ${branch} --force`);
    logs.push(pushRes);
    success = pushRes.success;
    if (!success) errorMsg = 'Force push failed.';
  } else if (mode === 'reset-local') {
    // git reset --hard origin/branch
    const resetRes = await runGit(localPath, `git reset --hard origin/${branch}`);
    logs.push(resetRes);
    success = resetRes.success;
    if (!success) errorMsg = 'Reset failed.';
  }

  if (success) {
    res.json({ success: true, logs });
  } else {
    res.status(500).json({ error: errorMsg || 'Operation failed', logs });
  }
});

// Abort ongoing rebase or merge if conflict resolution is skipped
app.post('/api/git-abort', async (req, res) => {
  const { localPath, type } = req.body; // 'merge' or 'rebase'
  if (!localPath || !fs.existsSync(localPath)) {
    return res.status(400).json({ error: 'Valid local path is required' });
  }

  const logs = [];
  let cmd = '';
  if (type === 'rebase') cmd = 'git rebase --abort';
  else if (type === 'merge') cmd = 'git merge --abort';
  else return res.status(400).json({ error: 'Invalid abort type' });

  const abortRes = await runGit(localPath, cmd);
  logs.push(abortRes);

  if (abortRes.success) {
    res.json({ success: true, logs });
  } else {
    res.status(500).json({ error: 'Abort failed', logs });
  }
});

// Start server
// Start server with dynamic port detection
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    
    // Automatically open browser on startup
    const url = `http://localhost:${port}`;
    let openCmd = '';
    if (process.platform === 'win32') {
      openCmd = `start ${url}`;
    } else if (process.platform === 'darwin') {
      openCmd = `open ${url}`;
    } else {
      openCmd = `xdg-open ${url}`;
    }
    
    exec(openCmd, (err) => {
      if (err) console.log(`Please open your browser and navigate to ${url}`);
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is already in use, trying next port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(PORT);
