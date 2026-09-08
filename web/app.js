/**
 * cb-indexer Web Dashboard Controller
 */

// Application State
const state = {
  currentProject: '',
  projects: [],
  overview: null,
  status: null,
  authToken: localStorage.getItem('OSS_INDEXER_AUTH_TOKEN') || '',
  serverAuthRequired: null,
  filterQuery: '',
  isIndexing: false,
  zoomLevel: 1,
  panX: 0,
  panY: 0,
  isDragging: false,
  dragNode: null,
  nodePositions: new Map(),
};

// API Fetch Helper
async function fetchAPI(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (state.authToken) {
    headers['Authorization'] = `Bearer ${state.authToken}`;
    headers['X-API-Key'] = state.authToken;
  }

  const response = await fetch(endpoint, { ...options, headers });
  if (response.status === 401) {
    showToast('Unauthorized (401): Check your API Auth Token', 'error');
    updateAuthLabel(true);
    throw new Error('Unauthorized');
  }
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `HTTP ${response.status}`);
  }
  return response.json();
}

// Toast Notifications
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let iconSvg = '';
  if (type === 'success') {
    iconSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  } else if (type === 'error') {
    iconSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  } else {
    iconSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
  }

  toast.innerHTML = `<span style="display:flex; align-items:center;">${iconSvg}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Load Available Projects
async function loadProjects() {
  try {
    const data = await fetchAPI('/api/projects');
    state.projects = data.registered_projects || [];

    const select = document.getElementById('project-selector');
    select.innerHTML = '';

    if (state.projects.length === 0) {
      select.innerHTML = '<option value="">(Default Workspace)</option>';
      state.currentProject = '';
    } else {
      state.projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.project_id || p.registry_path;
        opt.textContent = `${p.name || p.project_id} (${p.total_repos || 0} repos)`;
        select.appendChild(opt);
      });

      const exists = state.projects.some(p => (p.project_id || p.registry_path) === state.currentProject);
      if (!exists && state.projects.length > 0) {
        state.currentProject = state.projects[0].project_id || state.projects[0].registry_path;
      }
      if (state.currentProject) {
        select.value = state.currentProject;
      }
    }
  } catch (err) {
    console.error('Failed to load projects:', err);
  }
}

// Load Dashboard Data (Overview + Status)
async function loadDashboardData() {
  const refreshIcon = document.getElementById('refresh-icon');
  if (refreshIcon) refreshIcon.style.animation = 'spin 1s linear infinite';

  try {
    const url = state.currentProject ? `/api/overview?project=${encodeURIComponent(state.currentProject)}` : '/api/overview';
    const [overview, statusData] = await Promise.all([
      fetchAPI(url),
      fetchAPI('/api/status'),
    ]);

    state.overview = overview;
    state.status = statusData;

    renderStats();
    renderServices();
    renderTopologyGraph();
    renderTimeline();

  } catch (err) {
    console.error('Data load error:', err);
  } finally {
    if (refreshIcon) refreshIcon.style.animation = 'none';
  }
}

// Render Stats Cards (100% Project Focused)
function renderStats() {
  if (!state.overview) return;

  // Update Navbar Active Project Badge
  const navProj = document.getElementById('nav-project-id');
  if (navProj) {
    navProj.textContent = state.overview.project_id || state.currentProject || 'workspace';
  }
  const navBadge = document.getElementById('nav-project-badge');
  if (navBadge && state.overview.project_name) {
    navBadge.title = `Active Project: ${state.overview.project_name} [${state.overview.project_id || ''}]`;
  }

  // Project / Root GitHub Link
  let rootGit = state.overview.git_url;
  if (!rootGit && state.overview.repos) {
    const rootRepo = state.overview.repos.find(r => r.git_origin === 'root' && r.git_url);
    if (rootRepo) {
      const match = rootRepo.git_url.match(/^(https?:\/\/github\.com\/[^\/]+\/[^\/]+)/);
      rootGit = match ? match[1] : rootRepo.git_url;
    }
  }

  const projGitBtn = document.getElementById('project-github-link');
  const projGitLabel = document.getElementById('project-github-label');
  const navGitLink = document.getElementById('nav-github-link');
  const navGitText = document.getElementById('nav-github-text');

  if (rootGit) {
    const shortRepo = rootGit.replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\.git$/, '');
    if (projGitBtn) {
      projGitBtn.href = rootGit;
      projGitBtn.style.display = 'inline-flex';
      projGitBtn.title = `Project GitHub Repository: ${rootGit}`;
      if (projGitLabel) projGitLabel.textContent = shortRepo;
    }
    if (navGitLink) {
      navGitLink.href = rootGit;
      navGitLink.style.display = 'inline-flex';
      navGitLink.title = `Project GitHub Repository: ${rootGit}`;
      if (navGitText) navGitText.textContent = shortRepo.split('/').pop() || 'GitHub';
    }
  } else {
    if (projGitBtn) projGitBtn.style.display = 'none';
    if (navGitLink) navGitLink.style.display = 'none';
  }

  // Show / Hide Delete Project Buttons
  const delBtn = document.getElementById('btn-open-delete-project');
  const sideDelBtn = document.getElementById('btn-sidebar-delete-project');
  const hasActiveProject = Boolean(state.currentProject && state.currentProject !== '');
  if (delBtn) delBtn.style.display = hasActiveProject ? 'inline-flex' : 'none';
  if (sideDelBtn) sideDelBtn.style.display = hasActiveProject ? 'inline-flex' : 'none';

  const totalServices = state.overview.repos ? state.overview.repos.length : (state.overview.total_repos || 0);
  const indexedCount = state.overview.indexed_repos !== undefined ? state.overview.indexed_repos : (state.overview.repos?.filter(r => r.is_indexed).length || 0);

  // 1. Total Services
  const elemServices = document.getElementById('stat-services');
  if (elemServices) elemServices.textContent = totalServices.toLocaleString();
  const elemServicesSub = document.getElementById('stat-services-sub');
  if (elemServicesSub) {
    const techSet = new Set();
    state.overview.repos?.forEach(r => r.tech_stack?.forEach(t => techSet.add(t)));
    elemServicesSub.textContent = techSet.size > 0 ? `${techSet.size} Tech Stack${techSet.size > 1 ? 's' : ''}` : 'Microservices & apps';
  }

  // 2. Index Coverage
  const elemCoverage = document.getElementById('stat-coverage');
  if (elemCoverage) elemCoverage.textContent = `${indexedCount} / ${totalServices}`;
  const elemCoverageSub = document.getElementById('stat-coverage-sub');
  if (elemCoverageSub) {
    const pct = totalServices > 0 ? Math.round((indexedCount / totalServices) * 100) : 0;
    elemCoverageSub.textContent = totalServices === 0 ? 'No services registered' : (pct === 100 ? '100% Fully Indexed' : `${pct}% Knowledge Graph`);
  }

  // 3. Total Nodes & Edges
  let totalNodes = state.overview.total_nodes || 0;
  let totalEdges = state.overview.total_edges || 0;
  if (!totalNodes && state.overview.repos) {
    state.overview.repos.forEach(r => {
      totalNodes += (r.index_nodes || 0);
      totalEdges += (r.index_edges || 0);
    });
  }
  const elemNodes = document.getElementById('stat-nodes');
  if (elemNodes) elemNodes.textContent = totalNodes.toLocaleString();
  const elemNodesSub = document.getElementById('stat-nodes-sub');
  if (elemNodesSub) elemNodesSub.textContent = totalEdges ? `${totalEdges.toLocaleString()} call edges` : 'AST code entities';

  // 4. Service Connections
  const totalRels = state.overview.relationships ? state.overview.relationships.length : (state.overview.total_relationships || 0);
  const elemConns = document.getElementById('stat-connections');
  if (elemConns) elemConns.textContent = totalRels.toLocaleString();
  const elemConnsSub = document.getElementById('stat-connections-sub');
  if (elemConnsSub) elemConnsSub.textContent = totalRels === 1 ? '1 inter-service link' : `${totalRels} inter-service links`;

  // Live Daemon Status in Top Navbar
  const isIndexing = state.status?.is_indexing;
  const daemonPill = document.getElementById('header-daemon-status');
  if (daemonPill) {
    if (isIndexing) {
      daemonPill.className = 'daemon-pill daemon-indexing';
      daemonPill.innerHTML = `
        <span class="pulse-dot pulse-blue"></span>
        <span id="header-daemon-text">Indexing...</span>`;
    } else {
      daemonPill.className = 'daemon-pill daemon-active';
      daemonPill.innerHTML = `
        <span class="pulse-dot pulse-green"></span>
        <span id="header-daemon-text">Daemon Active</span>`;
    }
  }
}

// Render Service Grid
function renderServices() {
  const container = document.getElementById('services-container');
  if (!state.overview || !state.overview.repos || state.overview.repos.length === 0) {
    container.innerHTML = `
      <div style="grid-column:1/-1; text-align:center; padding:3rem; color:var(--text-dim);">
        <p style="font-size:1.1rem; margin-bottom:0.5rem;">No repositories registered in this project.</p>
        <p style="font-size:0.85rem;">Click <strong>"Scan New Project"</strong> above to discover microservices.</p>
      </div>`;
    return;
  }

  const q = state.filterQuery.toLowerCase();
  const filtered = state.overview.repos.filter(r => {
    if (!q) return true;
    const nameMatch = r.name.toLowerCase().includes(q);
    const descMatch = (r.description || '').toLowerCase().includes(q);
    const portMatch = r.port ? r.port.toString().includes(q) : false;
    const stackMatch = (r.tech_stack || []).some(s => s.toLowerCase().includes(q));
    return nameMatch || descMatch || portMatch || stackMatch;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column:1/-1; text-align:center; padding:2rem; color:var(--text-dim);">
        No services match "<strong>${state.filterQuery}</strong>"
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(repo => {
    const isIndexed = repo.is_indexed;
    const nodes = (repo.index_nodes || 0).toLocaleString();
    const edges = (repo.index_edges || 0).toLocaleString();

    let tagBadges = '';
    if (repo.tech_stack && repo.tech_stack.length > 0) {
      tagBadges = repo.tech_stack.map(tag => {
        let cls = 'tag';
        const tLower = tag.toLowerCase();
        if (tLower.includes('go')) cls += ' tag-go';
        else if (tLower.includes('node') || tLower.includes('js') || tLower.includes('express') || tLower.includes('react')) cls += ' tag-node';
        else if (tLower.includes('java') || tLower.includes('spring')) cls += ' tag-java';
        else if (tLower.includes('py') || tLower.includes('django') || tLower.includes('fastapi')) cls += ' tag-py';
        return `<span class="${cls}">${tag}</span>`;
      }).join('');
    }

    const portBadge = repo.port ? `<span class="service-port">:${repo.port}</span>` : '';
    const statusPulse = isIndexed ? 'pulse-green' : 'pulse-amber';
    const statusText = isIndexed ? `${nodes} AST nodes · ${edges} edges` : 'Not indexed';

    let gitBadge = '';
    if (repo.git_url) {
      const isRoot = repo.git_origin === 'root';
      const originClass = isRoot ? 'git-origin-root' : 'git-origin-service';
      const originLabel = isRoot ? 'Root' : 'Service';
      const displayUrl = repo.git_url.replace(/^https?:\/\/(www\.)?github\.com\//, '');
      gitBadge = `
        <div class="git-origin-row">
          <a href="${repo.git_url}" target="_blank" rel="noopener noreferrer" class="git-origin-badge ${originClass}" title="Source: ${originLabel} (${repo.git_url})" onclick="event.stopPropagation()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            <span>${originLabel}: ${displayUrl}</span>
          </a>
        </div>`;
    }

    return `
      <div class="service-card" data-repo="${repo.name}" style="cursor:pointer;">
        <div>
          <div class="service-top">
            <div class="service-name">${repo.name}</div>
            ${portBadge}
          </div>
          ${gitBadge}
          <div class="service-desc">${repo.description || 'No description provided.'}</div>
          <div class="service-tags">${tagBadges}</div>
        </div>
        <div class="service-footer">
          <div class="index-badge">
            <span class="pulse-dot ${statusPulse}"></span>
            <span>${statusText}</span>
          </div>
          <button class="btn btn-secondary btn-icon btn-reindex-repo" data-repo="${repo.name}" title="Re-index this service" style="padding:2px 8px; font-size:0.75rem; display:inline-flex; align-items:center; gap:4px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
            <span>Index</span>
          </button>
        </div>
      </div>`;
  }).join('');

  // Card click opens service modal
  container.querySelectorAll('.service-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-reindex-repo')) return;
      const repoName = card.getAttribute('data-repo');
      const repo = state.overview.repos.find(r => r.name === repoName);
      if (repo) openServiceModal(repo);
    });
  });

  // Attach per-repo index buttons
  container.querySelectorAll('.btn-reindex-repo').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const repoName = btn.getAttribute('data-repo');
      triggerReindex({ repoName });
    });
  });
}

// LocalStorage Persistence for Whiteboard Node Positions
function getNodeStorageKey(projectId) {
  const pId = projectId || state.overview?.project_id || state.currentProject || 'default';
  return `oss_indexer_nodes_${pId}`;
}

function loadSavedNodePositions(projectId) {
  try {
    const key = getNodeStorageKey(projectId);
    const raw = localStorage.getItem(key);
    if (raw) {
      const obj = JSON.parse(raw);
      state.nodePositions = new Map(Object.entries(obj));
    }
  } catch (err) {
    console.error('Failed to load node positions from localStorage:', err);
  }
}

function saveNodePositions() {
  try {
    if (!state.overview) return;
    const key = getNodeStorageKey(state.overview.project_id || state.currentProject);
    const obj = Object.fromEntries(state.nodePositions.entries());
    localStorage.setItem(key, JSON.stringify(obj));
  } catch (err) {
    console.error('Failed to save node positions to localStorage:', err);
  }
}

function clearSavedNodePositions(projectId) {
  try {
    const key = getNodeStorageKey(projectId);
    localStorage.removeItem(key);
    state.nodePositions.clear();
  } catch (err) {}
}

// Render Interactive SVG Topology Graph (Whiteboard Mode with Curved Arcs)
function renderTopologyGraph() {
  const svg = document.getElementById('topology-svg');
  if (!svg || !state.overview) return;

  const repos = state.overview.repos || [];
  const relationships = state.overview.relationships || [];

  const summary = document.getElementById('topology-summary');
  if (summary) {
    summary.textContent = `${repos.length} nodes, ${relationships.length} edges`;
  }

  // Update zoom indicator label
  const zoomIndicator = document.getElementById('zoom-value');
  if (zoomIndicator) {
    zoomIndicator.textContent = `${Math.round(state.zoomLevel * 100)}%`;
  }

  if (repos.length === 0) {
    svg.innerHTML = `
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#6b7280" font-size="13">
        No topology data available. Onboard services to visualize network.
      </text>`;
    return;
  }

  const width = svg.clientWidth || 800;
  const height = svg.clientHeight || 430;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.36;

  // Bounding box dimensions (Whiteboard perimeter)
  const bboxWidth = 1100;
  const bboxHeight = 720;
  const bboxX = centerX - bboxWidth / 2;
  const bboxY = centerY - bboxHeight / 2;

  // Load saved positions if not already loaded in memory
  if (state.nodePositions.size === 0) {
    loadSavedNodePositions(state.overview.project_id || state.currentProject);
  }

  // Initialize node positions in a circle within bounding box if not set
  repos.forEach((repo, i) => {
    if (!state.nodePositions.has(repo.name)) {
      const angle = (i / repos.length) * 2 * Math.PI - Math.PI / 2;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      state.nodePositions.set(repo.name, { x, y });
    }
  });

  // Group relationships by unordered node pair to detect stacked lines and curve them
  const pairGroups = new Map();
  relationships.forEach(rel => {
    const pKey = [rel.source, rel.target].sort().join(':::');
    if (!pairGroups.has(pKey)) {
      pairGroups.set(pKey, []);
    }
    pairGroups.get(pKey).push(rel);
  });

  // Build SVG curved edges
  let edgesHTML = '<g id="graph-edges">';
  pairGroups.forEach((rels, pKey) => {
    const total = rels.length;
    const [nodeA, nodeB] = pKey.split(':::');
    const posA = state.nodePositions.get(nodeA);
    const posB = state.nodePositions.get(nodeB);
    if (!posA || !posB) return;

    const dx = posB.x - posA.x;
    const dy = posB.y - posA.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

    // Unit vector along edge A -> B
    const ux = dx / dist;
    const uy = dy / dist;
    // Perpendicular normal vector
    const nx = -uy;
    const ny = ux;

    rels.forEach((rel, idx) => {
      const isForward = rel.source === nodeA;
      const srcPos = isForward ? posA : posB;
      const tgtPos = isForward ? posB : posA;

      let edgeColor = 'rgba(6, 182, 212, 0.7)';
      let dashArray = '4,2';
      let marker = 'url(#arrowhead)';
      if (rel.type === 'routes_to') {
        edgeColor = 'rgba(96, 165, 250, 0.85)';
        dashArray = 'none';
        marker = 'url(#arrowhead-blue)';
      } else if (rel.type === 'registers_with') {
        edgeColor = 'rgba(168, 85, 247, 0.8)';
        dashArray = '3,3';
        marker = 'url(#arrowhead-purple)';
      }

      if (total === 1) {
        // Single line
        const nodeR = 24;
        const x1 = srcPos.x + ((tgtPos.x - srcPos.x) * nodeR) / dist;
        const y1 = srcPos.y + ((tgtPos.y - srcPos.y) * nodeR) / dist;
        const x2 = tgtPos.x - ((tgtPos.x - srcPos.x) * (nodeR + 6)) / dist;
        const y2 = tgtPos.y - ((tgtPos.y - srcPos.y) * (nodeR + 6)) / dist;

        edgesHTML += `
          <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" 
            stroke="${edgeColor}" stroke-width="2" stroke-dasharray="${dashArray}" 
            marker-end="${marker}" class="graph-edge-path">
            <title>${rel.source} ➔ ${rel.target} (${rel.type}): ${rel.description || ''}</title>
          </line>`;
      } else {
        // Multiple stacked edges: Render distinct quadratic Bezier arcs!
        const baseSpread = 44;
        const offset = (idx - (total - 1) / 2) * baseSpread;

        const mx = (posA.x + posB.x) / 2;
        const my = (posA.y + posB.y) / 2;
        const cx = mx + nx * offset;
        const cy = my + ny * offset;

        // Tangent intersections at node circles (r=24 start, r=30 arrow head)
        const dSrc = Math.sqrt((cx - srcPos.x) ** 2 + (cy - srcPos.y) ** 2) || 1;
        const sx = srcPos.x + ((cx - srcPos.x) * 24) / dSrc;
        const sy = srcPos.y + ((cy - srcPos.y) * 24) / dSrc;

        const dTgt = Math.sqrt((tgtPos.x - cx) ** 2 + (tgtPos.y - cy) ** 2) || 1;
        const ex = tgtPos.x - ((tgtPos.x - cx) * 30) / dTgt;
        const ey = tgtPos.y - ((tgtPos.y - cy) * 30) / dTgt;

        edgesHTML += `
          <path d="M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}" 
            stroke="${edgeColor}" stroke-width="2" stroke-dasharray="${dashArray}" fill="none"
            marker-end="${marker}" class="graph-edge-path">
            <title>${rel.source} ➔ ${rel.target} (${rel.type}): ${rel.description || ''}</title>
          </path>`;
      }
    });
  });
  edgesHTML += '</g>';

  // Build SVG nodes
  let nodesHTML = '<g id="graph-nodes">';
  repos.forEach(repo => {
    const pos = state.nodePositions.get(repo.name);
    if (!pos) return;

    const isIndexed = repo.is_indexed;
    const strokeColor = isIndexed ? '#10b981' : '#3b82f6';
    const portLabel = repo.port ? `:${repo.port}` : '';

    nodesHTML += `
      <g class="graph-node-group" data-name="${repo.name}" transform="translate(${pos.x}, ${pos.y})" style="cursor:pointer;">
        <!-- Node Background & Glow Circle -->
        <circle r="23" fill="#0f172a" stroke="${strokeColor}" stroke-width="2.5" />
        <!-- Node SVG Vector Icon -->
        <g transform="translate(-9, -9)">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" fill="none" stroke="#93c5fd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="scale(0.75)"/>
        </g>
        <!-- Node Label -->
        <text y="38" text-anchor="middle" fill="#f3f4f6" font-size="11" font-weight="600" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.8));">${repo.name}</text>
        <!-- Port Badge -->
        ${portLabel ? `<text y="-30" text-anchor="middle" fill="#06b6d4" font-family="'Fira Code', monospace" font-size="10" font-weight="700">${portLabel}</text>` : ''}
      </g>`;
  });
  nodesHTML += '</g>';

  svg.innerHTML = `
    <defs>
      <!-- Whiteboard Dot Grid Pattern -->
      <pattern id="whiteboard-grid" width="28" height="28" patternUnits="userSpaceOnUse">
        <circle cx="14" cy="14" r="1.2" fill="rgba(255, 255, 255, 0.08)" />
      </pattern>

      <!-- Directional Arrowhead Markers -->
      <marker id="arrowhead" markerWidth="9" markerHeight="7" refX="7" refY="3.5" orient="auto">
        <polygon points="0 0, 9 3.5, 0 7" fill="#06b6d4" />
      </marker>
      <marker id="arrowhead-blue" markerWidth="9" markerHeight="7" refX="7" refY="3.5" orient="auto">
        <polygon points="0 0, 9 3.5, 0 7" fill="#60a5fa" />
      </marker>
      <marker id="arrowhead-purple" markerWidth="9" markerHeight="7" refX="7" refY="3.5" orient="auto">
        <polygon points="0 0, 9 3.5, 0 7" fill="#a855f7" />
      </marker>
    </defs>

    <!-- Infinite Whiteboard Grid -->
    <rect width="6000" height="6000" x="-3000" y="-3000" fill="url(#whiteboard-grid)" pointer-events="all" />

    <g id="viewport" transform="translate(${state.panX}, ${state.panY}) scale(${state.zoomLevel})">
      <!-- Luminous Whiteboard Bounding Box -->
      <rect class="whiteboard-bounds" x="${bboxX}" y="${bboxY}" width="${bboxWidth}" height="${bboxHeight}" rx="16" 
        fill="rgba(15, 23, 42, 0.35)" stroke="rgba(59, 130, 246, 0.35)" stroke-width="1.5" stroke-dasharray="8,5" />
      <text x="${bboxX + 16}" y="${bboxY + 24}" fill="rgba(96, 165, 250, 0.6)" font-family="'Fira Code', monospace" font-size="10" font-weight="700">⛶ WORKSPACE</text>

      ${edgesHTML}
      ${nodesHTML}
    </g>`;

  // Node Dragging & Click Handlers
  const nodeGroups = svg.querySelectorAll('.graph-node-group');
  nodeGroups.forEach(grp => {
    let isClick = true;
    grp.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      state.isDragging = true;
      state.dragNode = grp.getAttribute('data-name');
      isClick = true;
    });

    grp.addEventListener('mousemove', () => {
      isClick = false;
    });

    grp.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!isClick) return;
      const repoName = grp.getAttribute('data-name');
      const repo = state.overview.repos.find(r => r.name === repoName);
      if (repo) openServiceModal(repo);
    });
  });
}

// Global Whiteboard Pan & Drag Handler
window.addEventListener('DOMContentLoaded', () => {
  const svg = document.getElementById('topology-svg');
  if (!svg) return;

  // Mouse Down: Start Pan (if clicked on canvas)
  svg.addEventListener('mousedown', (e) => {
    if (e.target.closest('.graph-node-group')) return;
    state.isPanning = true;
    state.panStartX = e.clientX;
    state.panStartY = e.clientY;
    state.panOriginX = state.panX;
    state.panOriginY = state.panY;
    svg.classList.add('panning');
  });

  // Mouse Wheel: Zoom centered at cursor
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.12 : -0.12;
    const oldZoom = state.zoomLevel;
    const newZoom = Math.min(Math.max(state.zoomLevel + delta, 0.35), 2.5);

    if (newZoom === oldZoom) return;

    const rect = svg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const scaleFactor = newZoom / oldZoom;

    state.panX = mouseX - (mouseX - state.panX) * scaleFactor;
    state.panY = mouseY - (mouseY - state.panY) * scaleFactor;
    state.zoomLevel = newZoom;

    renderTopologyGraph();
  }, { passive: false });
});

// Window Mouse Move: Pan or Node Drag
window.addEventListener('mousemove', (e) => {
  const svg = document.getElementById('topology-svg');
  if (!svg) return;

  if (state.isPanning) {
    const dx = e.clientX - state.panStartX;
    const dy = e.clientY - state.panStartY;
    // Bounded Panning limit (+/- 1200px)
    const maxPan = 1200 * state.zoomLevel;
    state.panX = Math.max(-maxPan, Math.min(maxPan, state.panOriginX + dx));
    state.panY = Math.max(-maxPan, Math.min(maxPan, state.panOriginY + dy));
    renderTopologyGraph();
  } else if (state.isDragging && state.dragNode) {
    const rect = svg.getBoundingClientRect();
    const rawX = (e.clientX - rect.left - state.panX) / state.zoomLevel;
    const rawY = (e.clientY - rect.top - state.panY) / state.zoomLevel;

    // Clamp node position to stay inside bounding box
    const width = svg.clientWidth || 800;
    const height = svg.clientHeight || 430;
    const centerX = width / 2;
    const centerY = height / 2;
    const minX = centerX - 550 + 35;
    const maxX = centerX + 550 - 35;
    const minY = centerY - 360 + 45;
    const maxY = centerY + 360 - 45;

    const clampedX = Math.max(minX, Math.min(maxX, rawX));
    const clampedY = Math.max(minY, Math.min(maxY, rawY));

    state.nodePositions.set(state.dragNode, { x: clampedX, y: clampedY });
    renderTopologyGraph();
  }
});

// Window Mouse Up: End Pan and Drag
window.addEventListener('mouseup', () => {
  const svg = document.getElementById('topology-svg');
  if (svg) svg.classList.remove('panning');
  if (state.isDragging) {
    saveNodePositions();
  }
  state.isPanning = false;
  state.isDragging = false;
  state.dragNode = null;
});

// Service & AST Detail Modal
function openServiceModal(repo) {
  const modal = document.getElementById('modal-service');
  const title = document.getElementById('modal-service-title');
  const body = document.getElementById('modal-service-body');
  if (!modal || !body) return;

  title.textContent = repo.name;

  const isIndexed = repo.is_indexed;
  const nodes = (repo.index_nodes || 0).toLocaleString();
  const edges = (repo.index_edges || 0).toLocaleString();
  const port = repo.port ? `:${repo.port}` : 'None';
  const stacks = (repo.tech_stack || []).map(t => `<span class="tag">${t}</span>`).join(' ') || 'General';
  const indexedAt = repo.indexed_at ? new Date(repo.indexed_at).toLocaleString() : 'Never';

  // Find relationships
  const rels = state.overview.relationships || [];
  const outbound = rels.filter(r => r.source === repo.name);
  const inbound = rels.filter(r => r.target === repo.name);

  body.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; padding-bottom:0.75rem; border-bottom:1px solid var(--border-color);">
      <div>
        <div style="font-size:1.1rem; font-weight:700; color:#f3f4f6;">${repo.name}</div>
        <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">${repo.local_path || 'No local path'}</div>
      </div>
      <div style="text-align:right;">
        <span class="service-port" style="font-size:0.9rem;">${port}</span>
      </div>
    </div>

    <!-- AST Knowledge Graph Stats Box -->
    <div style="background:#0f172a; border:1px solid var(--border-color); border-radius:8px; padding:1rem; margin-bottom:1rem;">
      <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:0.5rem; font-weight:700;">
        AST Knowledge Graph Ingestion Status
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem; margin-bottom:0.5rem;">
        <div style="background:#1e293b; padding:0.6rem; border-radius:6px;">
          <div style="font-size:0.7rem; color:var(--text-muted);">Indexed AST Nodes</div>
          <div style="font-size:1.2rem; font-weight:700; color:#38bdf8;">${nodes}</div>
        </div>
        <div style="background:#1e293b; padding:0.6rem; border-radius:6px;">
          <div style="font-size:0.7rem; color:var(--text-muted);">Call Graph Edges</div>
          <div style="font-size:1.2rem; font-weight:700; color:#a855f7;">${edges}</div>
        </div>
      </div>
      <div style="font-size:0.75rem; color:var(--text-muted); display:flex; justify-content:space-between;">
        <span>Indexed: <strong style="color:#f3f4f6;">${indexedAt}</strong></span>
        <span>Status: <strong style="color:${isIndexed ? '#34d399' : '#f59e0b'};">${isIndexed ? 'Indexed in CBM' : 'Pending'}</strong></span>
      </div>
    </div>

    <!-- Tech Stack -->
    <div style="margin-bottom:1rem;">
      <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.35rem; font-weight:600;">Detected Technologies</div>
      <div style="display:flex; flex-wrap:wrap; gap:6px;">${stacks}</div>
    </div>

    ${repo.git_url ? `
    <!-- GitHub Origin & Repository Source -->
    <div style="background:#0f172a; border:1px solid var(--border-color); border-radius:8px; padding:0.75rem 1rem; margin-bottom:1rem;">
      <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:0.4rem; font-weight:700;">
        GitHub Repository Origin
      </div>
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
        <span class="git-origin-badge ${repo.git_origin === 'root' ? 'git-origin-root' : 'git-origin-service'}" style="font-size:0.75rem; padding:3px 8px;">
          Origin: ${repo.git_origin === 'root' ? 'Root Repository' : 'Service Repository'}
        </span>
        <a href="${repo.git_url}" target="_blank" rel="noopener noreferrer" style="font-size:0.8rem; color:#60a5fa; text-decoration:none; display:inline-flex; align-items:center; gap:4px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
          <span>Open on GitHub ↗</span>
        </a>
      </div>
      <div style="font-size:0.75rem; color:var(--text-muted); margin-top:6px; font-family:'Fira Code', monospace; word-break:break-all;">
        ${repo.git_url}
      </div>
    </div>` : ''}

    <!-- Service Relationships -->
    <div style="margin-bottom:1.25rem;">
      <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.35rem; font-weight:600;">Inter-Service Network Connections</div>
      <div style="font-size:0.8rem; background:#0f172a; border:1px solid var(--border-color); border-radius:6px; padding:0.6rem; max-height:120px; overflow-y:auto;">
        ${outbound.map(r => `<div style="color:#60a5fa; margin-bottom:3px;">➔ <strong>Calls ${r.target}</strong> (${r.type})</div>`).join('')}
        ${inbound.map(r => `<div style="color:#a855f7; margin-bottom:3px;">← <strong>Called by ${r.source}</strong> (${r.type})</div>`).join('')}
        ${outbound.length === 0 && inbound.length === 0 ? '<div style="color:var(--text-dim);">No direct inter-service calls registered</div>' : ''}
      </div>
    </div>

    <!-- Actions -->
    <div style="display:flex; justify-content:flex-end; gap:0.5rem; border-top:1px solid var(--border-color); padding-top:0.75rem;">
      <button class="btn btn-secondary" id="btn-close-service-modal">Close</button>
      <button class="btn btn-primary" id="btn-modal-reindex" style="display:inline-flex; align-items:center; gap:6px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
        <span>Re-index Service</span>
      </button>
    </div>
  `;

  modal.classList.add('active');

  document.getElementById('btn-close-service')?.addEventListener('click', () => {
    modal.classList.remove('active');
  });
  document.getElementById('btn-close-service-modal')?.addEventListener('click', () => {
    modal.classList.remove('active');
  });
  document.getElementById('btn-modal-reindex')?.addEventListener('click', () => {
    modal.classList.remove('active');
    triggerReindex({ repoName: repo.name });
  });
}

// Render Daemon Activity Logs
function renderTimeline() {
  const container = document.getElementById('timeline-container');
  if (!container) return;

  const logs = state.status?.daemon?.recent_logs || [];
  if (logs.length === 0) {
    container.innerHTML = `
      <div style="color:var(--text-dim); text-align:center; padding:1.5rem 0; font-size:0.8rem;">
        No indexing runs recorded yet.
      </div>`;
    return;
  }

  container.innerHTML = logs.map(l => {
    const timeStr = new Date(l.timestamp).toLocaleTimeString();
    const hasErrors = l.errors && l.errors.length > 0;
    const dotCls = hasErrors ? 'style="border-color:#f43f5e;"' : '';
    const indexed = l.indexed || l.indexed_repos || [];

    return `
      <div class="timeline-item" ${dotCls}>
        <div class="timeline-time">${timeStr} · ${l.duration_ms || 0}ms</div>
        <div class="timeline-content">
          <strong>${l.project_id || 'workspace'}</strong>: Indexed ${indexed.length}/${l.total_repos || indexed.length} repo(s)
          ${indexed.length > 0 ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">${indexed.join(', ')}</div>` : ''}
          ${hasErrors ? `<div style="color:#f87171; font-size:0.72rem; margin-top:2px;">${l.errors.join('; ')}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

// Connect to real-time events stream
function initRealtimeEvents() {
  if (!window.EventSource) return;

  try {
    const eventSource = new EventSource('/api/events');

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        handleLiveEvent(data);
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    eventSource.onerror = () => {
      // Reconnect automatically handled by browser EventSource
    };
  } catch (e) {
    console.warn('SSE initialization failed:', e);
  }
}

function handleLiveEvent(evt) {
  if (evt.type === 'connected') return;

  const container = document.getElementById('timeline-container');
  if (!container) return;

  const emptyMsg = container.querySelector('div[style*="text-align:center"]');
  if (emptyMsg) emptyMsg.remove();

  const timeStr = evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();

  if (evt.type === 'started') {
    showToast(`⚡ ${evt.message || 'Starting indexing...'}`, 'info');
    const item = document.createElement('div');
    item.className = 'timeline-item';
    item.id = 'live-job-item';
    item.innerHTML = `
      <div class="timeline-time">${timeStr} · In Progress</div>
      <div class="timeline-content">
        <span class="pulse-dot pulse-blue" style="display:inline-block; margin-right:4px;"></span>
        <strong>${evt.project_id || 'Project'}</strong>: ${evt.message}
        <div id="live-progress-bar" style="margin-top:6px; font-size:0.75rem; color:#60a5fa;">
          0 / ${evt.total || 1} indexed
        </div>
      </div>`;
    container.prepend(item);
  } else if (evt.type === 'progress') {
    const liveBar = document.getElementById('live-progress-bar');
    if (liveBar) {
      liveBar.textContent = `[${evt.current}/${evt.total}] ${evt.repo_name}: ${evt.status} ${evt.duration_ms ? `(${evt.duration_ms}ms)` : '...'}`;
      liveBar.style.color = evt.status === 'failed' ? '#f87171' : (evt.status === 'success' ? '#34d399' : '#60a5fa');
    }
    if (evt.status === 'success' || evt.status === 'failed') {
      const icon = evt.status === 'success' ? '✓' : '✗';
      const color = evt.status === 'success' ? '#34d399' : '#f87171';
      const miniItem = document.createElement('div');
      miniItem.className = 'timeline-item';
      miniItem.style.borderLeftColor = color;
      miniItem.innerHTML = `
        <div class="timeline-time">${timeStr} · ${evt.duration_ms || 0}ms</div>
        <div class="timeline-content">
          <span style="color:${color}; font-weight:bold; margin-right:4px;">${icon}</span>
          <strong>${evt.repo_name}</strong> ${evt.status}
          ${evt.message ? `<div style="font-size:0.72rem; color:var(--text-muted);">${evt.message}</div>` : ''}
        </div>`;
      container.prepend(miniItem);
    }
  } else if (evt.type === 'completed') {
    const liveJob = document.getElementById('live-job-item');
    if (liveJob) liveJob.remove();
    showToast(`🎉 ${evt.message || 'Indexing completed!'}`, 'success');
    loadDashboardData();
  }
}

// Trigger Re-index Action
async function triggerReindex({ repoName = '', pull = false } = {}) {
  const btn = document.getElementById('btn-reindex-all');
  if (btn) btn.disabled = true;

  let targetProj = state.currentProject;
  if (!targetProj) {
    const sel = document.getElementById('project-selector');
    if (sel && sel.value) {
      targetProj = sel.value;
      state.currentProject = sel.value;
    }
  }

  showToast(`Initiating ${repoName ? `re-index for ${repoName}` : 'batch indexing'}...`, 'info');

  try {
    const res = await fetchAPI('/api/trigger', {
      method: 'POST',
      body: JSON.stringify({
        project: targetProj,
        repo_name: repoName,
        mode: 'moderate',
        pull: pull,
      }),
    });

    showToast('Indexing completed successfully!', 'success');
    await loadDashboardData();
  } catch (err) {
    showToast(`Indexing failed: ${err.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Event Listeners Initialization
function initEvents() {
  // Project Selector
  document.getElementById('project-selector')?.addEventListener('change', (e) => {
    state.currentProject = e.target.value;
    state.nodePositions.clear();
    loadSavedNodePositions(state.currentProject);
    loadDashboardData();
  });

  // Refresh Button
  document.getElementById('btn-refresh')?.addEventListener('click', () => {
    loadDashboardData();
    showToast('Dashboard data refreshed', 'info');
  });

  // Search Filter
  document.getElementById('search-services')?.addEventListener('input', (e) => {
    state.filterQuery = e.target.value;
    renderServices();
  });

  // Action Buttons
  document.getElementById('btn-reindex-all')?.addEventListener('click', () => {
    triggerReindex({ pull: false });
  });

  document.getElementById('btn-pull-reindex')?.addEventListener('click', () => {
    triggerReindex({ pull: true });
  });

  // Zoom Controls
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
    state.zoomLevel = Math.min(state.zoomLevel + 0.15, 2.5);
    renderTopologyGraph();
  });

  document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
    state.zoomLevel = Math.max(state.zoomLevel - 0.15, 0.4);
    renderTopologyGraph();
  });

  document.getElementById('btn-zoom-reset')?.addEventListener('click', () => {
    state.zoomLevel = 1;
    state.panX = 0;
    state.panY = 0;
    renderTopologyGraph();
  });

  document.getElementById('btn-layout-reset')?.addEventListener('click', () => {
    clearSavedNodePositions(state.overview?.project_id || state.currentProject);
    renderTopologyGraph();
    showToast('Node positions reset to circular layout', 'info');
  });

  // Scan Modal
  const modalScan = document.getElementById('modal-scan');
  document.getElementById('btn-open-scan')?.addEventListener('click', () => {
    modalScan.classList.add('active');
  });
  document.getElementById('btn-close-scan')?.addEventListener('click', () => {
    modalScan.classList.remove('active');
  });
  document.getElementById('btn-cancel-scan')?.addEventListener('click', () => {
    modalScan.classList.remove('active');
  });

  // Browse Folder Button (Native OS Explorer)
  const btnBrowse = document.getElementById('btn-browse-folder');
  btnBrowse?.addEventListener('click', async () => {
    const origContent = btnBrowse.innerHTML;
    btnBrowse.disabled = true;
    btnBrowse.innerHTML = `<span>Browsing...</span>`;
    try {
      const res = await fetchAPI('/api/browse-folder', { method: 'POST' });
      if (res.status === 'success' && res.path) {
        document.getElementById('scan-path').value = res.path;
        const pIdInput = document.getElementById('scan-project-id');
        if (!pIdInput.value.trim()) {
          const parts = res.path.split(/[\\/]/).filter(Boolean);
          if (parts.length > 0) {
            pIdInput.value = parts[parts.length - 1];
          }
        }
        showToast(`Selected directory: ${res.path}`, 'success');
      } else if (res.status === 'error') {
        showToast(`Folder selection error: ${res.message}`, 'error');
      }
    } catch (err) {
      showToast(`Could not open explorer: ${err.message}`, 'error');
    } finally {
      btnBrowse.disabled = false;
      btnBrowse.innerHTML = origContent;
    }
  });

  document.getElementById('btn-submit-scan')?.addEventListener('click', async () => {
    const wsPath = document.getElementById('scan-path').value.trim();
    const pId = document.getElementById('scan-project-id').value.trim();

    if (!wsPath) {
      showToast('Workspace path is required', 'error');
      return;
    }

    showToast(`Scanning workspace: ${wsPath}...`, 'info');
    try {
      const res = await fetchAPI('/api/scan', {
        method: 'POST',
        body: JSON.stringify({ workspace_path: wsPath, project_id: pId }),
      });
      showToast(`Scan complete: Found ${res.repos_count} repositories!`, 'success');
      modalScan.classList.remove('active');
      if (res.project_id) {
        state.currentProject = res.project_id;
      }
      await loadProjects();
      await loadDashboardData();
    } catch (err) {
      showToast(`Scan failed: ${err.message}`, 'error');
    }
  });

  // Auth Modal
  const modalAuth = document.getElementById('modal-auth');
  const authInput = document.getElementById('auth-token-input');

  document.getElementById('btn-open-auth')?.addEventListener('click', () => {
    authInput.value = state.authToken;
    modalAuth.classList.add('active');
  });
  document.getElementById('btn-close-auth')?.addEventListener('click', () => {
    modalAuth.classList.remove('active');
  });
  document.getElementById('btn-cancel-auth')?.addEventListener('click', () => {
    modalAuth.classList.remove('active');
  });

  document.getElementById('btn-save-auth')?.addEventListener('click', () => {
    state.authToken = authInput.value.trim();
    localStorage.setItem('OSS_INDEXER_AUTH_TOKEN', state.authToken);
    updateAuthLabel();
    modalAuth.classList.remove('active');
    showToast('API Auth Token saved', 'success');
    loadDashboardData();
  });

  document.getElementById('btn-clear-auth')?.addEventListener('click', () => {
    state.authToken = '';
    localStorage.removeItem('OSS_INDEXER_AUTH_TOKEN');
    authInput.value = '';
    updateAuthLabel();
    modalAuth.classList.remove('active');
    showToast('API Auth Token cleared', 'info');
    loadDashboardData();
  });

  // Delete Project Modal Handlers
  const modalDelete = document.getElementById('modal-delete-project');
  const deleteInput = document.getElementById('delete-confirm-input');
  const deleteBtn = document.getElementById('btn-confirm-delete-project');

  function openDeleteProjectModal() {
    const pId = (state.overview?.project_id || state.currentProject || '').trim();
    if (!pId) {
      showToast('No active project selected to delete', 'error');
      return;
    }
    const nameElem = document.getElementById('delete-modal-project-name');
    const targetElem = document.getElementById('delete-confirm-target');
    if (nameElem) nameElem.textContent = pId;
    if (targetElem) targetElem.textContent = pId;
    if (deleteInput) {
      deleteInput.value = '';
    }
    if (deleteBtn) {
      deleteBtn.disabled = true;
      deleteBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        <span>Delete Project</span>`;
    }
    modalDelete?.classList.add('active');
    setTimeout(() => deleteInput?.focus(), 50);
  }

  function closeDeleteProjectModal() {
    modalDelete?.classList.remove('active');
    if (deleteInput) deleteInput.value = '';
  }

  document.getElementById('btn-open-delete-project')?.addEventListener('click', openDeleteProjectModal);
  document.getElementById('btn-sidebar-delete-project')?.addEventListener('click', openDeleteProjectModal);
  document.getElementById('btn-close-delete-project')?.addEventListener('click', closeDeleteProjectModal);
  document.getElementById('btn-cancel-delete-project')?.addEventListener('click', closeDeleteProjectModal);

  // GitHub-style confirmation: user must type exact project ID
  deleteInput?.addEventListener('input', (e) => {
    const pId = (state.overview?.project_id || state.currentProject || '').trim();
    const typed = e.target.value.trim();
    if (deleteBtn) {
      deleteBtn.disabled = typed !== pId;
    }
  });

  deleteBtn?.addEventListener('click', async () => {
    const pId = (state.overview?.project_id || state.currentProject || '').trim();
    if (!pId) return;

    deleteBtn.disabled = true;
    deleteBtn.innerHTML = '<span>Deleting project & graphs...</span>';

    const purgeGraphs = document.getElementById('delete-purge-graphs')?.checked ?? true;

    try {
      await fetchAPI('/api/project/remove', {
        method: 'POST',
        body: JSON.stringify({
          project_id: pId,
          purge_graphs: purgeGraphs,
        }),
      });

      clearSavedNodePositions(pId);
      closeDeleteProjectModal();
      showToast(`Project '${pId}' has been deleted.`, 'success');

      state.currentProject = '';
      state.overview = null;
      state.nodePositions.clear();

      await loadProjects();
      await loadDashboardData();
    } catch (err) {
      showToast(`Failed to delete project: ${err.message}`, 'error');
      if (deleteBtn) deleteBtn.disabled = false;
    }
  });

  updateAuthLabel();
}

async function checkServerHealth() {
  try {
    const res = await fetch('/health');
    if (res.ok) {
      const data = await res.json();
      state.serverAuthRequired = typeof data.auth_required === 'boolean' ? data.auth_required : null;
      updateAuthLabel();
    }
  } catch (e) {
    // ignore
  }
}

function updateAuthLabel(isUnauthorized = false) {
  const lbl = document.getElementById('auth-status-label');
  if (!lbl) return;

  if (isUnauthorized) {
    lbl.textContent = 'Auth Failed';
    lbl.style.color = '#f87171';
    lbl.title = 'Server rejected API token (401 Unauthorized)';
    return;
  }

  if (state.serverAuthRequired === false) {
    lbl.textContent = state.authToken ? 'Auth (Disabled)' : 'No Auth';
    lbl.style.color = 'var(--text-muted)';
    lbl.title = 'Server running in open mode (OSS_INDEXER_AUTH_TOKEN is not set on server)';
  } else if (state.serverAuthRequired === true) {
    if (state.authToken) {
      lbl.textContent = 'Active';
      lbl.style.color = '#34d399';
      lbl.title = 'API Auth Token configured and required by server';
    } else {
      lbl.textContent = 'Token Req';
      lbl.style.color = '#fbbf24';
      lbl.title = 'Server requires an Auth Token to access data';
    }
  } else {
    lbl.textContent = state.authToken ? 'Active' : 'Auth';
    lbl.style.color = state.authToken ? '#34d399' : 'var(--text-muted)';
  }
}

// Initial Boot
window.addEventListener('DOMContentLoaded', async () => {
  initEvents();
  initRealtimeEvents();
  await checkServerHealth();
  await loadProjects();
  await loadDashboardData();

  // Background polling every 12 seconds
  setInterval(() => {
    if (!state.isIndexing) {
      checkServerHealth();
      loadDashboardData();
    }
  }, 12000);
});
