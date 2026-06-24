// Application State
let state = {
  authenticated: false,
  user: null,
  folders: {}, // { "owner/repo": "localPath" }
  nicknames: {}, // { "owner/repo": "nickname" }
  repositories: [],
  activeRepo: null,
  activeRepoStatus: null,
  activeFilter: 'all', // 'all', 'connected', 'unconnected'
  searchTerm: ''
};

// DOM Elements
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

// Login Screen
const loginScreen = document.getElementById('login-screen');
const loginForm = document.getElementById('login-form');
const patTokenInput = document.getElementById('pat-token');
const loginError = document.getElementById('login-error');

// Dashboard Screen
const dashboardScreen = document.getElementById('dashboard-screen');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const btnLogout = document.getElementById('btn-logout');

// Sidebar / Repo List
const repoList = document.getElementById('repo-list');
const countTotal = document.getElementById('count-total');
const searchInput = document.getElementById('search-input');
const btnScanRepos = document.getElementById('btn-scan-repos');
const tabAll = document.getElementById('tab-all');
const tabConnected = document.getElementById('tab-connected');
const tabUnconnected = document.getElementById('tab-unconnected');

// Details View
const emptyDetailsView = document.getElementById('empty-details-view');
const detailsView = document.getElementById('details-view');
const activeRepoName = document.getElementById('active-repo-name');
const activeRepoBadge = document.getElementById('active-repo-badge');
const activeLocalPath = document.getElementById('active-local-path');
const btnDisconnect = document.getElementById('btn-disconnect');
const inputNickname = document.getElementById('input-nickname');
const btnSaveNickname = document.getElementById('btn-save-nickname');

// Setup Git Section
const gitSetupSection = document.getElementById('git-setup-section');
const btnActionClone = document.getElementById('btn-action-clone');
const btnActionConnect = document.getElementById('btn-action-connect');

// Git Operations Section
const gitOpsSection = document.getElementById('git-ops-section');
const gitBranchName = document.getElementById('git-branch-name');
const gitSyncState = document.getElementById('git-sync-state');
const divergedAlert = document.getElementById('diverged-alert');
const changesCount = document.getElementById('changes-count');
const changesList = document.getElementById('changes-list');

// Reconcile Buttons
const btnReconcileMerge = document.getElementById('btn-reconcile-merge');
const btnReconcileRebase = document.getElementById('btn-reconcile-rebase');
const btnReconcileForce = document.getElementById('btn-reconcile-force');
const btnReconcileReset = document.getElementById('btn-reconcile-reset');
const abortActionContainer = document.getElementById('abort-action-container');
const btnAbortRebase = document.getElementById('btn-abort-rebase');
const btnAbortMerge = document.getElementById('btn-abort-merge');

// Push / Pull Tab Panels
const actionTabPush = document.getElementById('action-tab-push');
const actionTabPull = document.getElementById('action-tab-pull');
const actionPanelPush = document.getElementById('action-panel-push');
const actionPanelPull = document.getElementById('action-panel-pull');

// Push Form
const chkAutoCommit = document.getElementById('chk-auto-commit');
const commitMsgGroup = document.getElementById('commit-msg-group');
const inputCommitMsg = document.getElementById('input-commit-msg');
const btnGitPush = document.getElementById('btn-git-push');
const btnGitPushOnly = document.getElementById('btn-git-push-only');

// Pull Form
const btnGitPull = document.getElementById('btn-git-pull');

// Console Logs
const consoleLogs = document.getElementById('console-logs');
const btnClearConsole = document.getElementById('btn-clear-console');


/* ----------------------------------------------------
   UTILITIES: Loading UI and Terminal Logging
---------------------------------------------------- */

function showLoading(text) {
  loadingText.textContent = text || '처리 중...';
  loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
}

function logToConsole(text, type = 'stdout') {
  const line = document.createElement('div');
  line.classList.add('console-line', type);
  
  const timestamp = new Date().toISOString().substring(11, 19);
  line.textContent = `[${timestamp}] ${text}`;
  
  consoleLogs.appendChild(line);
  consoleLogs.scrollTop = consoleLogs.scrollHeight;
}

// Log a batch of Git command response logs
function logGitResponse(responseLogs) {
  if (!responseLogs || !Array.isArray(responseLogs)) return;
  
  responseLogs.forEach(log => {
    logToConsole(`$ ${log.cmd}`, 'cmd');
    if (log.stdout) {
      logToConsole(log.stdout, 'stdout');
    }
    if (log.stderr) {
      // Git prints normal progress outputs (like fetching/cloning) to stderr.
      // So we log it as stderr but don't necessarily treat it as a crash.
      logToConsole(log.stderr, log.success ? 'stdout' : 'stderr');
    }
    if (log.success) {
      logToConsole(`-> 명령어 성공 완료 (코드 0)`, 'success');
    } else {
      logToConsole(`-> 에러 발생 (종료 코드 ${log.code})`, 'stderr');
    }
  });
}


/* ----------------------------------------------------
   API CALLS
---------------------------------------------------- */

async function apiFetch(url, options = {}) {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    
    const data = await res.json();
    if (!res.ok) {
      if (data.logs) {
        logGitResponse(data.logs);
      }
      throw new Error(data.error || `HTTP error! status: ${res.status}`);
    }
    return data;
  } catch (err) {
    logToConsole(`API Error (${url}): ${err.message}`, 'stderr');
    throw err;
  }
}

// Check configuration and authenticate
async function initApp() {
  showLoading('GitHub 연결 상태 확인 중...');
  try {
    const configData = await apiFetch('/api/config');
    state.folders = configData.folders || {};
    state.nicknames = configData.nicknames || {};
    
    if (configData.authenticated) {
      state.authenticated = true;
      state.user = configData.user;
      
      // Update UI
      userAvatar.src = state.user.avatar_url;
      userName.textContent = state.user.login;
      
      loginScreen.classList.add('hidden');
      dashboardScreen.classList.remove('hidden');
      
      logToConsole(`GitHub 계정 연동 성공: ${state.user.login}`, 'success');
      
      // Fetch Repositories
      await fetchRepositories();
    } else {
      state.authenticated = false;
      state.user = null;
      
      loginScreen.classList.remove('hidden');
      dashboardScreen.classList.add('hidden');
    }
  } catch (err) {
    logToConsole('애플리케이션 초기화 실패: ' + err.message, 'stderr');
  } finally {
    hideLoading();
  }
}

// Fetch repositories
async function fetchRepositories() {
  try {
    logToConsole('GitHub 저장소 목록 불러오는 중...', 'system');
    const repos = await apiFetch('/api/repos');
    state.repositories = repos;
    
    logToConsole(`${repos.length}개의 저장소를 불러왔습니다.`, 'success');
    renderRepoList();
  } catch (err) {
    logToConsole('저장소 목록 불러오기 실패: ' + err.message, 'stderr');
  }
}


/* ----------------------------------------------------
   RENDER UI
---------------------------------------------------- */

function renderRepoList() {
  repoList.innerHTML = '';
  repoList.scrollTop = 0;
  
  // Filter repositories
  const filtered = state.repositories.filter(repo => {
    const nameMatch = repo.full_name.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
                      (repo.description && repo.description.toLowerCase().includes(state.searchTerm.toLowerCase()));
    
    const isConnected = !!state.folders[repo.full_name];
    
    if (state.activeFilter === 'connected') {
      return nameMatch && isConnected;
    } else if (state.activeFilter === 'unconnected') {
      return nameMatch && !isConnected;
    }
    
    return nameMatch;
  });
  
  countTotal.textContent = `${filtered.length} 개의 저장소`;
  
  if (filtered.length === 0) {
    repoList.innerHTML = '<div class="empty-state">조건에 부합하는 저장소가 없습니다.</div>';
    return;
  }
  
  filtered.forEach(repo => {
    const isConnected = !!state.folders[repo.full_name];
    const localPath = state.folders[repo.full_name];
    const nickname = state.nicknames[repo.full_name];
    
    const card = document.createElement('div');
    card.className = `repo-card ${isConnected ? 'connected' : ''} ${state.activeRepo && state.activeRepo.id === repo.id ? 'selected' : ''}`;
    
    card.innerHTML = `
      <div class="repo-card-top">
        <div style="display: flex; flex-direction: column; max-width: 78%; gap: 2px;">
          ${nickname ? `<h3 style="max-width: 100%;">${nickname}</h3><span class="repo-original-name">${repo.full_name}</span>` : `<h3 style="max-width: 100%;">${repo.name}</h3>`}
        </div>
        <span class="badge ${repo.private ? 'private' : 'public'}">${repo.private ? 'Private' : 'Public'}</span>
      </div>
      <p class="repo-desc">${repo.description || '설명이 없습니다.'}</p>
      <div class="repo-card-meta">
        <div class="meta-left">
          <span class="dot-indicator"></span>
          <span>${isConnected ? '연결됨 (로컬)' : '로컬 연결 필요'}</span>
        </div>
        <span>${new Date(repo.updated_at).toLocaleDateString()}</span>
      </div>
    `;
    
    card.addEventListener('click', () => selectRepository(repo));
    repoList.appendChild(card);
  });
}

// Select a repository to display details
async function selectRepository(repo) {
  state.activeRepo = repo;
  
  // Highlight selected card
  const cards = repoList.querySelectorAll('.repo-card');
  cards.forEach(c => c.classList.remove('selected'));
  
  // Re-render repo list to make sure selection is styled correctly
  renderRepoList();
  
  // Show details view
  emptyDetailsView.classList.add('hidden');
  detailsView.classList.remove('hidden');
  
  // Render details header
  const nickname = state.nicknames[repo.full_name];
  if (nickname) {
    activeRepoName.innerHTML = `${nickname} <span class="repo-original-name" style="display: inline-block; margin-left: 10px; margin-top: 0;">(${repo.full_name})</span>`;
  } else {
    activeRepoName.textContent = repo.full_name;
  }
  activeRepoBadge.textContent = repo.private ? 'Private' : 'Public';
  activeRepoBadge.className = `badge ${repo.private ? 'private' : 'public'}`;
  
  // Set current nickname input value
  inputNickname.value = nickname || '';
  
  const isConnected = !!state.folders[repo.full_name];
  
  if (isConnected) {
    const path = state.folders[repo.full_name];
    activeLocalPath.textContent = path;
    btnDisconnect.classList.remove('hidden');
    gitSetupSection.classList.add('hidden');
    gitOpsSection.classList.remove('hidden');
    
    // Fetch Git Status for this folder
    await refreshGitStatus();
  } else {
    activeLocalPath.textContent = '설정되지 않음';
    btnDisconnect.classList.add('hidden');
    gitSetupSection.classList.remove('hidden');
    gitOpsSection.classList.add('hidden');
  }
}

// Refresh Git Status
async function refreshGitStatus() {
  if (!state.activeRepo) return;
  
  const repoFullName = state.activeRepo.full_name;
  const localPath = state.folders[repoFullName];
  
  gitBranchName.textContent = '-';
  gitSyncState.innerHTML = '<span class="text-dark">확인 중...</span>';
  changesList.innerHTML = '<div class="clean-state">상태 분석 중...</div>';
  divergedAlert.classList.add('hidden');
  abortActionContainer.classList.add('hidden');
  
  logToConsole(`[${repoFullName}] 로컬 저장소 상태 파악 중...`, 'system');
  
  try {
    const statusData = await apiFetch('/api/git-status', {
      method: 'POST',
      body: JSON.stringify({ localPath, repoFullName })
    });
    
    state.activeRepoStatus = statusData;
    
    if (!statusData.isGit) {
      gitBranchName.textContent = 'Git 저장소 아님';
      gitSyncState.innerHTML = '<span class="text-danger">⚠️ 폴더 내 .git 설정이 없습니다.</span>';
      changesList.innerHTML = `
        <div class="clean-state">
          이 폴더는 Git 저장소가 아닙니다. 수동으로 파일들을 확인해 주세요.
        </div>`;
      return;
    }
    
    // Branch Name
    gitBranchName.textContent = statusData.branch;
    
    // Render Changed Files list
    changesCount.textContent = statusData.changedFiles.length;
    if (statusData.changedFiles.length > 0) {
      changesList.innerHTML = '';
      statusData.changedFiles.forEach(fileLine => {
        // Parse "XY path" format robustly using regex
        const match = fileLine.trim().match(/^([MADRCU?!\s]{1,2})\s+(.+)$/);
        let typeChar = '';
        let filePath = fileLine;
        
        if (match) {
          typeChar = match[1].trim();
          filePath = match[2];
        }
        
        let typeClass = 'modified';
        let typeName = '수정';
        
        if (typeChar === 'A' || typeChar === '??') {
          typeClass = 'added';
          typeName = '추가';
        } else if (typeChar === 'D') {
          typeClass = 'deleted';
          typeName = '삭제';
        }
        
        const item = document.createElement('div');
        item.className = `change-item ${typeClass}`;
        item.innerHTML = `
          <span class="change-type-badge">${typeName}</span>
          <span class="file-path">${filePath}</span>
        `;
        changesList.appendChild(item);
      });
    } else {
      changesList.innerHTML = '<div class="clean-state">변경된 파일이 없습니다. 로컬 폴더에서 손으로 파일을 수정해 보세요!</div>';
    }
    
    // Render Sync State & Diverge Warning
    let syncHtml = '';
    
    if (!statusData.remoteExists) {
      syncHtml = '<span class="badge private">원격 브랜치 없음</span>';
    } else if (statusData.diverged) {
      syncHtml = '<span class="badge private" style="background-color: rgba(239, 68, 68, 0.1); color: var(--accent-red); border-color: rgba(239, 68, 68, 0.25);">⚠️ 동기화 어긋남 (Diverged)</span>';
      divergedAlert.classList.remove('hidden');
      
      logToConsole(`⚠️ [${repoFullName}] 원격과 로컬의 이력이 달라 병합/융합이 필요합니다! (로컬 기준 앞섬: ${statusData.ahead}개, 뒤처짐: ${statusData.behind}개)`, 'stderr');
    } else if (statusData.ahead > 0) {
      syncHtml = `<span class="badge public">로컬 커밋 있음 (Push 필요: ${statusData.ahead})</span>`;
    } else if (statusData.behind > 0) {
      syncHtml = `<span class="badge private">원격 변경 있음 (Pull 필요: ${statusData.behind})</span>`;
    } else {
      syncHtml = '<span class="badge public">동기화 완료 (Up-to-date)</span>';
    }
    
    gitSyncState.innerHTML = syncHtml;
    
    // Check if there is an active merge/rebase conflict that we can abort
    const hasRebase = statusData.logs.some(log => log.stdout.includes('rebase in progress') || log.stderr.includes('rebase in progress'));
    const hasMerge = statusData.logs.some(log => log.stdout.includes('MERGE_HEAD') || log.stderr.includes('merge in progress'));
    
    if (hasRebase) {
      abortActionContainer.classList.remove('hidden');
      btnAbortRebase.classList.remove('hidden');
      btnAbortMerge.classList.add('hidden');
    } else if (hasMerge) {
      abortActionContainer.classList.remove('hidden');
      btnAbortMerge.classList.remove('hidden');
      btnAbortRebase.classList.add('hidden');
    }
    
    logToConsole(`[${repoFullName}] 로컬 분석 완료. 브랜치: ${statusData.branch}, 수정된 파일: ${statusData.changedFiles.length}개`, 'success');
  } catch (err) {
    logToConsole(`[${repoFullName}] 상태 불러오기 실패: ${err.message}`, 'stderr');
  }
}


/* ----------------------------------------------------
   EVENT HANDLERS & GIT ACTIONS
---------------------------------------------------- */

// Login Form Submit
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = patTokenInput.value.trim();
  if (!token) return;
  
  showLoading('GitHub 토큰 확인 및 로그인 중...');
  loginError.classList.add('hidden');
  
  try {
    const data = await apiFetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ token })
    });
    
    if (data.success) {
      state.authenticated = true;
      state.user = data.user;
      
      userAvatar.src = state.user.avatar_url;
      userName.textContent = state.user.login;
      
      loginScreen.classList.add('hidden');
      dashboardScreen.classList.remove('hidden');
      
      logToConsole(`GitHub 계정 연동 성공: ${state.user.login}`, 'success');
      
      // Load config to refresh folders
      const configData = await apiFetch('/api/config');
      state.folders = configData.folders || {};
      state.nicknames = configData.nicknames || {};
      
      await fetchRepositories();
    }
  } catch (err) {
    loginError.textContent = '로그인 실패: ' + err.message;
    loginError.classList.remove('hidden');
  } finally {
    hideLoading();
  }
});

// Logout Button Click
btnLogout.addEventListener('click', async () => {
  if (!confirm('로그아웃 하시겠습니까? 로컬 폴더 연결 정보는 로컬 컴퓨터에 안전하게 유지됩니다.')) return;
  
  showLoading('로그아웃 중...');
  try {
    await apiFetch('/api/logout', { method: 'POST' });
    state.authenticated = false;
    state.user = null;
    state.repositories = [];
    state.activeRepo = null;
    
    loginScreen.classList.remove('hidden');
    dashboardScreen.classList.add('hidden');
    
    logToConsole('로그아웃되었습니다.', 'system');
  } catch (err) {
    logToConsole('로그아웃 중 오류: ' + err.message, 'stderr');
  } finally {
    hideLoading();
  }
});

// Search input handler
searchInput.addEventListener('input', (e) => {
  state.searchTerm = e.target.value;
  renderRepoList();
});

// Filter Tabs handlers
tabAll.addEventListener('click', () => {
  tabAll.classList.add('active');
  tabConnected.classList.remove('active');
  tabUnconnected.classList.remove('active');
  state.activeFilter = 'all';
  renderRepoList();
});

tabConnected.addEventListener('click', () => {
  tabAll.classList.remove('active');
  tabConnected.classList.add('active');
  tabUnconnected.classList.remove('active');
  state.activeFilter = 'connected';
  renderRepoList();
});

tabUnconnected.addEventListener('click', () => {
  tabAll.classList.remove('active');
  tabConnected.classList.remove('active');
  tabUnconnected.classList.add('active');
  state.activeFilter = 'unconnected';
  renderRepoList();
});

// Scan Local Repositories Click
btnScanRepos.addEventListener('click', async () => {
  if (!confirm('컴퓨터 내(C드라이브 일부, D드라이브, E드라이브)에서 GitHub과 연동된 로컬 저장소들을 검색해 자동으로 대시보드와 연결하시겠습니까?\n프로젝트 개수에 따라 10초~30초 가량 소요될 수 있습니다.')) return;
  
  showLoading('로컬 Git 저장소 탐색 및 연동 중...');
  logToConsole('로컬 드라이브에서 GitHub 연동 저장소 검색을 시작합니다...', 'system');
  
  try {
    const data = await apiFetch('/api/scan-repos', { method: 'POST' });
    
    logToConsole(`스캔 완료! 검색된 저장소 총합: ${data.totalCount}개 (새로 연동된 저장소: ${data.newCount}개)`, 'success');
    if (data.newlyAdded && data.newlyAdded.length > 0) {
      logToConsole('새로 발견되어 연동된 저장소 목록:', 'success');
      data.newlyAdded.forEach(item => {
        logToConsole(`- ${item.repo} -> ${item.path}`, 'success');
      });
    } else {
      logToConsole('새롭게 발견된 저장소가 없습니다. 기존 연결 정보를 유지합니다.', 'system');
    }
    
    // Refresh configuration state and repositories list
    const configData = await apiFetch('/api/config');
    state.folders = configData.folders || {};
    state.nicknames = configData.nicknames || {};
    
    await fetchRepositories();
    
    // Refresh active repository details if one is selected
    if (state.activeRepo) {
      await selectRepository(state.activeRepo);
    }
    
    alert(`스캔 완료!\n총 ${data.totalCount}개의 저장소가 연동되었습니다.\n(새로 추가됨: ${data.newCount}개)`);
  } catch (err) {
    logToConsole('로컬 저장소 자동 탐색 실패: ' + err.message, 'stderr');
    alert('자동 탐색 중 오류가 발생했습니다. 하단 콘솔 로그를 확인해 주세요.');
  } finally {
    hideLoading();
  }
});

// Disconnect local folder map
btnDisconnect.addEventListener('click', async () => {
  if (!state.activeRepo) return;
  const repoFullName = state.activeRepo.full_name;
  
  if (!confirm(`[${repoFullName}] 저장소와 로컬 폴더의 연결을 해제하시겠습니까?\n실제 파일이나 폴더는 삭제되지 않습니다.`)) return;
  
  showLoading('로컬 폴더 맵핑 해제 중...');
  try {
    const data = await apiFetch('/api/disconnect-folder', {
      method: 'POST',
      body: JSON.stringify({ repoFullName })
    });
    
    state.folders = data.folders || {};
    logToConsole(`[${repoFullName}] 저장소 로컬 폴더 연결 해제 완료`, 'system');
    
    // Refresh selection UI
    await selectRepository(state.activeRepo);
  } catch (err) {
    logToConsole('연결 해제 실패: ' + err.message, 'stderr');
  } finally {
    hideLoading();
  }
});

// Folder Connect (Existing Local folder)
btnActionConnect.addEventListener('click', async () => {
  if (!state.activeRepo) return;
  const repoFullName = state.activeRepo.full_name;
  
  logToConsole('기존 깃 저장소 폴더 선택 대기 중...', 'system');
  try {
    const pickerData = await apiFetch('/api/select-folder', { method: 'POST' });
    const localPath = pickerData.selectedPath;
    
    if (!localPath) {
      logToConsole('폴더 선택이 취소되었습니다.', 'system');
      return;
    }
    
    showLoading('기존 로컬 폴더 경로 맵핑 중...');
    const data = await apiFetch('/api/connect-folder', {
      method: 'POST',
      body: JSON.stringify({ repoFullName, localPath })
    });
    
    state.folders = data.folders || {};
    logToConsole(`[${repoFullName}] -> [${localPath}] 로컬 경로 연결 성공`, 'success');
    
    await selectRepository(state.activeRepo);
  } catch (err) {
    logToConsole('폴더 연결 에러: ' + err.message, 'stderr');
  } finally {
    hideLoading();
  }
});

// Save Repository Nickname
btnSaveNickname.addEventListener('click', async () => {
  if (!state.activeRepo) return;
  const repoFullName = state.activeRepo.full_name;
  const nickname = inputNickname.value.trim();

  showLoading('저장소 별명 설정 중...');
  try {
    const data = await apiFetch('/api/set-nickname', {
      method: 'POST',
      body: JSON.stringify({ repoFullName, nickname })
    });
    
    state.nicknames = data.nicknames || {};
    logToConsole(`[${repoFullName}] 별명 설정 완료: ${nickname || '(없음)'}`, 'success');
    
    // Refresh selection UI & Repository list
    await selectRepository(state.activeRepo);
  } catch (err) {
    logToConsole('별명 설정 실패: ' + err.message, 'stderr');
  } finally {
    hideLoading();
  }
});

// Folder Clone (New Local Folder Clone)
btnActionClone.addEventListener('click', async () => {
  if (!state.activeRepo) return;
  const repoFullName = state.activeRepo.full_name;
  const cloneUrl = state.activeRepo.clone_url;
  const repoName = state.activeRepo.name;
  
  logToConsole('클론할 위치(상위 폴더) 선택 대기 중...', 'system');
  try {
    const pickerData = await apiFetch('/api/select-folder', { method: 'POST' });
    const parentPath = pickerData.selectedPath;
    
    if (!parentPath) {
      logToConsole('폴더 선택이 취소되었습니다.', 'system');
      return;
    }
    
    // Automatically append repository name to prevent cloning into root folder directly
    const localPath = `${parentPath}\\${repoName}`;
    
    if (!confirm(`다음 경로에 새로운 폴더를 생성하고 깃 클론을 시작할까요?\n경로: ${localPath}`)) {
      logToConsole('클론 작업이 취소되었습니다.', 'system');
      return;
    }
    
    showLoading(`Git 클론 시작 (${repoName})... 잠시만 기다려 주세요.`);
    logToConsole(`깃 클론 명령어 실행 중... 대상 폴더: ${localPath}`, 'system');
    
    const cloneData = await apiFetch('/api/git-clone', {
      method: 'POST',
      body: JSON.stringify({ cloneUrl, localPath, repoFullName })
    });
    
    logGitResponse(cloneData.logs);
    
    if (cloneData.success) {
      logToConsole(`클론이 완료되었습니다! 맵핑 경로: ${cloneData.localPath}`, 'success');
      
      // Reload config to update state folders
      const configData = await apiFetch('/api/config');
      state.folders = configData.folders || {};
      
      await selectRepository(state.activeRepo);
    }
  } catch (err) {
    logToConsole('클론 작업 중 오류가 발생했습니다. 로그 콘솔을 확인해 주세요.', 'stderr');
    // If we have returned logs, they will be logged inside apiFetch catch or handled separately
  } finally {
    hideLoading();
  }
});

// Git Pull action
btnGitPull.addEventListener('click', async () => {
  if (!state.activeRepo) return;
  const repoFullName = state.activeRepo.full_name;
  const localPath = state.folders[repoFullName];
  
  showLoading('원격 저장소에서 변경 가져오는 중 (Pull)...');
  logToConsole(`[${repoFullName}] git pull 실행 중...`, 'system');
  
  try {
    const data = await apiFetch('/api/git-pull', {
      method: 'POST',
      body: JSON.stringify({ localPath })
    });
    
    logGitResponse(data.logs);
    logToConsole(`[${repoFullName}] 깃 풀 완료`, 'success');
    await refreshGitStatus();
  } catch (err) {
    logToConsole('Pull 실패. 로그 콘솔의 충돌 여부를 확인하세요.', 'stderr');
  } finally {
    hideLoading();
  }
});

// Checkbox for Auto-Commit message toggle
chkAutoCommit.addEventListener('change', (e) => {
  if (e.target.checked) {
    commitMsgGroup.style.display = 'none';
  } else {
    commitMsgGroup.style.display = 'block';
  }
});

// Git Push Action (Commit & Push)
btnGitPush.addEventListener('click', async () => {
  if (!state.activeRepo) return;
  const repoFullName = state.activeRepo.full_name;
  const localPath = state.folders[repoFullName];
  
  const autoCommit = chkAutoCommit.checked;
  const commitMessage = autoCommit ? '' : inputCommitMsg.value.trim();
  
  if (!autoCommit && !commitMessage) {
    alert('수동 커밋 메시지를 선택하셨습니다. 커밋 메시지를 입력해 주세요.');
    return;
  }
  
  showLoading('변경사항 커밋 및 푸시 중...');
  logToConsole(`[${repoFullName}] git push 실행 준비 중 (자동커밋: ${autoCommit})...`, 'system');
  
  try {
    const data = await apiFetch('/api/git-push', {
      method: 'POST',
      body: JSON.stringify({ localPath, autoCommit, commitMessage })
    });
    
    logGitResponse(data.logs);
    logToConsole(`[${repoFullName}] 커밋 및 푸시 성공!`, 'success');
    
    // Clear input message
    inputCommitMsg.value = '';
    await refreshGitStatus();
  } catch (err) {
    logToConsole('Push 실패. 로컬과 원격이 달라 거부되었거나 충돌이 났을 수 있습니다. 동기화 상태 및 로그를 확인하세요.', 'stderr');
  } finally {
    hideLoading();
  }
});

// Git Push-only Action
btnGitPushOnly.addEventListener('click', async () => {
  if (!state.activeRepo) return;
  const repoFullName = state.activeRepo.full_name;
  const localPath = state.folders[repoFullName];
  
  showLoading('원격 저장소로 단순 푸시 중 (git push)...');
  logToConsole(`[${repoFullName}] git push 실행 중...`, 'system');
  
  try {
    const data = await apiFetch('/api/git-push', {
      method: 'POST',
      body: JSON.stringify({ localPath, autoCommit: false })
    });
    
    logGitResponse(data.logs);
    logToConsole(`[${repoFullName}] 단순 푸시 완료!`, 'success');
    await refreshGitStatus();
  } catch (err) {
    logToConsole('Push 실패. 원격 브랜치에 올라가지 않은 로컬 커밋 상태와 충돌 여부를 점검하세요.', 'stderr');
  } finally {
    hideLoading();
  }
});

// Git Reconcile (융합) handler
async function handleReconcile(mode) {
  if (!state.activeRepo || !state.activeRepoStatus) return;
  const repoFullName = state.activeRepo.full_name;
  const localPath = state.folders[repoFullName];
  const branch = state.activeRepoStatus.branch;
  
  let confirmMsg = '';
  if (mode === 'merge') confirmMsg = '원격의 새로운 커밋을 현재 로컬 브랜치에 병합(Merge)합니까?';
  else if (mode === 'rebase') confirmMsg = '로컬 커밋들을 원격 커밋들의 끝으로 다시 정렬(Rebase)합니까?';
  else if (mode === 'force-push') confirmMsg = '⚠️ 경고! 원격 깃허브의 변경사항을 덮어쓰고 현재 로컬 내용으로 강제 푸시(Force Push)합니다. 원격 데이터가 유실될 수 있습니다. 진행할까요?';
  else if (mode === 'reset-local') confirmMsg = '⚠️ 경고! 현재 로컬에 저장되지 않은 코드와 커밋을 모두 버리고, 원격 깃허브의 내용을 그대로 로컬로 덮어씁니다(Reset --hard). 계속할까요?';
  
  if (!confirm(confirmMsg)) return;
  
  showLoading(`브랜치 융합 처리 중 (${mode})...`);
  logToConsole(`[${repoFullName}] 브랜치 융합 명령어 실행 중: Mode = ${mode}`, 'system');
  
  try {
    const data = await apiFetch('/api/git-reconcile', {
      method: 'POST',
      body: JSON.stringify({ localPath, mode, branch })
    });
    
    logGitResponse(data.logs);
    logToConsole(`[${repoFullName}] 브랜치 융합 (${mode}) 작업이 완료되었습니다!`, 'success');
    await refreshGitStatus();
  } catch (err) {
    logToConsole(`융합 실패: ${err.message}`, 'stderr');
    // Reload git status because a merge conflict or rebase conflict might have updated files/state
    await refreshGitStatus();
  } finally {
    hideLoading();
  }
}

btnReconcileMerge.addEventListener('click', () => handleReconcile('merge'));
btnReconcileRebase.addEventListener('click', () => handleReconcile('rebase'));
btnReconcileForce.addEventListener('click', () => handleReconcile('force-push'));
btnReconcileReset.addEventListener('click', () => handleReconcile('reset-local'));

// Git Abort handlers
async function handleAbort(type) {
  if (!state.activeRepo) return;
  const repoFullName = state.activeRepo.full_name;
  const localPath = state.folders[repoFullName];
  
  showLoading(`${type} 작업을 취소하고 원래 상태로 복원 중...`);
  try {
    const data = await apiFetch('/api/git-abort', {
      method: 'POST',
      body: JSON.stringify({ localPath, type })
    });
    logGitResponse(data.logs);
    logToConsole(`[${repoFullName}] ${type} 작업 취소 완료.`, 'success');
    await refreshGitStatus();
  } catch (err) {
    logToConsole(`작업 취소 실패: ${err.message}`, 'stderr');
  } finally {
    hideLoading();
  }
}

btnAbortRebase.addEventListener('click', () => handleAbort('rebase'));
btnAbortMerge.addEventListener('click', () => handleAbort('merge'));

// Push/Pull Tab click handlers
actionTabPush.addEventListener('click', () => {
  actionTabPush.classList.add('active');
  actionTabPull.classList.remove('active');
  actionPanelPush.classList.remove('hidden');
  actionPanelPull.classList.add('hidden');
});

actionTabPull.addEventListener('click', () => {
  actionTabPush.classList.remove('active');
  actionTabPull.classList.add('active');
  actionPanelPush.classList.add('hidden');
  actionPanelPull.classList.remove('hidden');
});

// Clear console
btnClearConsole.addEventListener('click', () => {
  consoleLogs.innerHTML = '<div class="console-line system">[System] 콘솔 로그가 지워졌습니다.</div>';
});


/* ----------------------------------------------------
   APP INITIALIZATION
---------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});
