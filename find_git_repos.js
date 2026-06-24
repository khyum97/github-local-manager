const fs = require('fs');
const path = require('path');

const IGNORE_DIRS = new Set([
  'node_modules',
  'venv',
  '.venv',
  'AppData',
  'Local Settings',
  'Application Data',
  'System Volume Information',
  '$RECYCLE.BIN',
  '$Recycle.Bin',
  'Windows',
  'Program Files',
  'Program Files (x86)',
  'pinokio',
  'SillyTavern',
  'stable-diffusion-webui-master',
  'models',
  'Ollama',
  'Local',
  'Roaming',
  'cache',
  '.cache',
  'tmp',
  'temp',
  'Downloads',
  'Pictures',
  'Music',
  'Videos',
  'Saved Games',
  'Searches',
  'Links',
  '.gemini',
  '.git',
  'local_llm',
  'local_llm_agent',
  'python',
  'OPENCLAW',
  'openllmvtuber',
  'subllm',
  'wan2gp 설정백업'
]);

const roots = [
  'D:\\',
  'E:\\',
  'C:\\Users\\yumji\\Documents',
  'C:\\Users\\yumji\\Desktop'
];

const foundRepos = [];

function scanDirectory(dir, depth = 0) {
  if (depth > 3) return; // 최대 깊이를 3으로 제한하여 성능 극대화 (예: E:\CLAUDE-CODE\프로젝트 => depth 2)
  
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch (e) {
    return; // 접근 권한 에러 등 무시
  }

  // 1. 현재 디렉토리에 .git 폴더가 있는지 체크
  if (files.includes('.git')) {
    const gitPath = path.join(dir, '.git');
    const configPath = path.join(gitPath, 'config');
    if (fs.existsSync(configPath)) {
      try {
        const configText = fs.readFileSync(configPath, 'utf8');
        const match = configText.match(/url\s*=\s*([^\s\r\n]+)/);
        if (match) {
          const url = match[1].trim();
          let repoPath = '';
          if (url.includes('github.com/')) {
            repoPath = url.split('github.com/')[1];
          } else if (url.includes('github.com:')) {
            repoPath = url.split('github.com:')[1];
          }
          if (repoPath) {
            if (repoPath.endsWith('.git')) {
              repoPath = repoPath.slice(0, -4);
            }
            repoPath = repoPath.trim();
            
            // 토큰 정보가 포함되어 있는 경우 정제 (예: x-access-token:ghp_xxx@github.com/owner/repo)
            const parts = repoPath.split('/');
            if (parts.length >= 2) {
              const owner = parts[parts.length - 2];
              const repo = parts[parts.length - 1];
              const cleanRepo = `${owner}/${repo}`;
              foundRepos.push({
                path: dir,
                url: url,
                repo: cleanRepo
              });
              return; // Git 저장소를 찾았으므로 하위 폴더는 스캔하지 않음
            }
          }
        }
      } catch (e) {}
    }
  }

  // 2. 하위 디렉토리 탐색
  for (const file of files) {
    if (IGNORE_DIRS.has(file)) continue;
    if (file.startsWith('.')) continue; // 숨김 폴더 무시
    
    const fullPath = path.join(dir, file);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        scanDirectory(fullPath, depth + 1);
      }
    } catch (e) {}
  }
}

console.log('컴퓨터 내 GitHub 연동 저장소를 검색하는 중입니다...');
const start = Date.now();
for (const root of roots) {
  if (fs.existsSync(root)) {
    console.log(`탐색 경로: ${root}`);
    scanDirectory(root);
  }
}
console.log(`탐색 완료 (소요시간: ${((Date.now() - start) / 1000).toFixed(2)}초)`);
console.log(`발견된 저장소 개수: ${foundRepos.length}`);

// config.json 파일 업데이트
const configFilePath = path.join(__dirname, 'config.json');
let config = { folders: {}, nicknames: {} };
if (fs.existsSync(configFilePath)) {
  try {
    config = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
  } catch (e) {}
}

if (!config.folders) config.folders = {};
if (!config.nicknames) config.nicknames = {};

foundRepos.forEach(item => {
  config.folders[item.repo] = item.path;
  // 별명이 없을 경우에만 폴더명으로 기본값 설정
  if (!config.nicknames[item.repo]) {
    config.nicknames[item.repo] = path.basename(item.path);
  }
});

fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), 'utf8');
console.log('\n[성공] config.json에 연동 저장소 목록이 업데이트되었습니다.');
console.log(JSON.stringify(config.folders, null, 2));
