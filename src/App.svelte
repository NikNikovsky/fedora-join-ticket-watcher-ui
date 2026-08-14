<script lang="ts">
  import { onMount } from 'svelte';
  import heroImage from './assets/hero.png';
  import type { Issue } from './lib/types';

  const OWNER = 'join';
  const REPO = 'WelcomeToFedora';
  const PRODUCTION_FORGE_BASE_URL = 'https://forge.fedoraproject.org';
  const FORGE_BASE_URL = import.meta.env.PROD ? PRODUCTION_FORGE_BASE_URL : '/forge';

  let token = '';
  let state: 'open' | 'all' | 'closed' = 'open';
  let labels = '';
  let sinceDays = 14;
  let pageSize = 50;
  let currentPage = 1;

  let loading = false;
  let status = 'Paste a token, then load issues.';
  let statusKind: 'ok' | 'error' = 'ok';
  let debug = '';
  let issues: Issue[] = [];
  let totalIssues = 0;
  let totalPages = 1;
  let pageIssues: Issue[] = [];

  let showReminders = false;
  let reminderThresholdDays = 14;
  let reminderIssues: Issue[] = [];
  let now = Date.now();
  let localTimeLabel = '';
  let timeZoneLabel = '';
  const timestampFormatter = new Intl.DateTimeFormat([], {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  function toPositiveInt(value: unknown, fallback: number) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  function setStatus(msg: string, kind: 'ok' | 'error' = 'ok') {
    status = msg;
    statusKind = kind;
  }

  function getRecency(it: any) {
    return Date.parse(it.last_comment_at ?? it.updated_at);
  }

  function formatClock() {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
    now = Date.now();
    localTimeLabel = timestampFormatter.format(new Date(now));
    timeZoneLabel = timeZone;
  }

  function formatTimestamp(value?: string) {
    if (!value) {
      return 'unknown';
    }

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : timestampFormatter.format(new Date(parsed));
  }

  function formatDuration(ms: number) {
    const absMs = Math.max(0, Math.abs(ms));
    const days = Math.floor(absMs / dayMs);
    const hours = Math.floor((absMs % dayMs) / hourMs);
    const minutes = Math.floor((absMs % hourMs) / minuteMs);

    if (days > 0) {
      return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    }

    if (hours > 0) {
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }

    if (minutes > 0) {
      return `${minutes}m`;
    }

    return 'less than 1m';
  }

  function getReminderDeadline(issue: Issue) {
    const lastActivity = Date.parse(issue.last_comment_at ?? issue.updated_at);
    return lastActivity + reminderThresholdDays * dayMs;
  }

  function getReminderCountdown(issue: Issue) {
    const remaining = getReminderDeadline(issue) - now;
    if (remaining === 0) {
      return 'Due now';
    }

    return remaining > 0
      ? `Due in ${formatDuration(remaining)}`
      : `Overdue by ${formatDuration(remaining)}`;
  }

  function getReminderTone(issue: Issue) {
    return getReminderDeadline(issue) - now <= 0 ? 'late' : 'soon';
  }

  function compareByReminderCountdown(left: Issue, right: Issue) {
    const leftRemaining = getReminderDeadline(left) - now;
    const rightRemaining = getReminderDeadline(right) - now;

    if (leftRemaining !== rightRemaining) {
      return leftRemaining - rightRemaining;
    }

    return left.index - right.index;
  }

  function buildForgeUrl(path: string) {
    const base = FORGE_BASE_URL.endsWith('/') ? FORGE_BASE_URL.slice(0, -1) : FORGE_BASE_URL;
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${base}${suffix}`;
  }

  async function forgeFetch(path: string) {
    const url = buildForgeUrl(path);
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `token ${token.trim()}`
      },
      mode: 'cors',
      credentials: 'omit'
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
    return data;
  }

  async function fetchLastCommentCreatedAt(issueIndex: number, fallback: string): Promise<string> {
    try {
      const comments = await forgeFetch(`/api/v1/repos/${OWNER}/${REPO}/issues/${issueIndex}/comments`);
      if (Array.isArray(comments) && comments.length > 0) {
        // Filter out system events (like label additions) by requiring a text body
        const textComments = comments.filter((c: any) => c.body && c.body.trim().length > 0);
        
        if (textComments.length > 0) {
          const lastComment = textComments[textComments.length - 1];
          return lastComment?.created_at ?? fallback;
        }
      }
    } catch {
      // Fall back if comment fetching fails or hits a permissions error
    }
    return fallback;
  }

  async function normalizeIssues(data: any): Promise<Issue[]> {
    const rows = Array.isArray(data)
      ? data
      : Array.isArray(data?.issues)
        ? data.issues
        : Array.isArray(data?.data)
          ? data.data
          : Object.values(data ?? {}).filter((v) => v && typeof v === 'object');

    return Promise.all(
      rows.map(async (it: any) => {
        // Base the default time on the issue's original creation, not its last update
        let lastCommentAt = it.created_at;
        
        // Account for Forgejo's varying payload keys for comment counts
        const hasComments = (typeof it.comments === 'number' && it.comments > 0) || 
                            (typeof it.comments_count === 'number' && it.comments_count > 0) || 
                            (Array.isArray(it.comments) && it.comments.length > 0);
        
        if (hasComments) {
          // Pass created_at as the fallback
          lastCommentAt = await fetchLastCommentCreatedAt(it.number, it.created_at);
        }

        return {
          index: it.number,
          title: it.title ?? 'Untitled Issue',
          updated_at: it.updated_at,
          last_comment_at: lastCommentAt,
          labels: it.labels ?? [],
          assignees: (it.assignees ?? []).map((a: any) => a?.login).filter(Boolean),
          html_url: it.html_url ?? '#'
        };
      })
    );
  }

  function updatePageSlice() {
    const safePageSize = Math.max(1, toPositiveInt(pageSize, 50));
    const sortedIssues = [...issues].sort(compareByReminderCountdown);
    totalIssues = sortedIssues.length;
    totalPages = Math.max(1, Math.ceil(totalIssues / safePageSize));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);
    const start = (currentPage - 1) * safePageSize;
    pageIssues = sortedIssues.slice(start, start + safePageSize);
  }

  function goToPage(page: number) {
    currentPage = page;
    updatePageSlice();
  }

  async function loadIssues() {
    if (!token.trim()) return setStatus('Token is required.', 'error');
    loading = true;
    setStatus('Loading issues and comment timelines...');
    reminderIssues = [];
    showReminders = false;
    try {
      const apiPageSize = 50;
      const fetchedIssues: Issue[] = [];
      let page = 1;

      while (true) {
        const params = new URLSearchParams({
          state,
          limit: String(apiPageSize),
          page: String(page)
        });
        if (labels.trim()) params.set('labels', labels.trim());

        const data = await forgeFetch(`/api/v1/repos/${OWNER}/${REPO}/issues?${params.toString()}`);
        const pageRows = await normalizeIssues(data);
        fetchedIssues.push(...pageRows);

        if (pageRows.length < apiPageSize) break;
        page += 1;
      }

      const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
      const recentCount = fetchedIssues.filter((it) => getRecency(it) >= cutoff).length;
      debug = `rows=${fetchedIssues.length} recent=${recentCount}`;
      issues = fetchedIssues;
      
      currentPage = 1;
      updatePageSlice();

      const reminderCutoff = Date.now() - reminderThresholdDays * 24 * 60 * 60 * 1000;
      reminderIssues = fetchedIssues.filter((it) => getRecency(it) < reminderCutoff).sort(compareByReminderCountdown);
      showReminders = reminderIssues.length > 0;
      setStatus(`Loaded ${issues.length} issue(s); ${recentCount} updated in the last ${sinceDays} day(s).` + (showReminders ? ` ${reminderIssues.length} reminder candidate(s).` : ''));
    } catch (e: any) {
      setStatus(e?.message ?? String(e), 'error');
      issues = [];
      pageIssues = [];
      totalIssues = 0;
      totalPages = 1;
    } finally {
      loading = false;
    }
  }

  function labelNames(issue: Issue) {
    return issue.labels.map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean);
  }

  onMount(() => {
    formatClock();
    const interval = setInterval(formatClock, minuteMs);

    return () => clearInterval(interval);
  });

  $: pageSize, now, updatePageSlice();
</script>

<svelte:head>
  <title>Welcome Ticket Watchers</title>
</svelte:head>

<main class="shell">
  <!-- Top Hero Header -->
  <section class="hero panel">
    <div class="hero-copy">
      <div class="eyebrow">Fedora-flavored issue watcher</div>
      <h1>Welcome Ticket Watchers</h1>
      <p>
        Load Forgejo issues, spot stale threads, and keep the follow-up list tidy without sending tokens to the server.
      </p>
      <div class="hero-stats">
        <div>
          <strong>{issues.length}</strong>
          <span>recent issues loaded</span>
        </div>
        <div>
          <strong>{localTimeLabel || 'loading…'}</strong>
          <span>{timeZoneLabel || 'your local timezone'}</span>
        </div>
        <div>
          <strong>{pageSize}</strong>
          <span>tickets per page</span>
        </div>
        <div>
          <strong>{reminderIssues.length}</strong>
          <span>reminders queued</span>
        </div>
      </div>
    </div>

    <div class="hero-art" aria-hidden="true">
      <img src={heroImage} alt="" />
    </div>
  </section>

  <!-- Side-Control Workspace Layout -->
  <div class:has-reminders={showReminders} class="workspace">
    <!-- Sidebar / Side-Controls -->
    <aside class="panel sidebar">
      <div class="section-title compact">
        <h2>Controls</h2>
      </div>
      <div class:bad={statusKind === 'error'} class="status">{status}</div>

      <div class="control-grid">
        <label>
          Forgejo token
          <input bind:value={token} type="password" placeholder="paste token" />
        </label>

        <label>
          Issue state
          <select bind:value={state}>
            <option value="open">open</option>
            <option value="all">all</option>
            <option value="closed">closed</option>
          </select>
        </label>

        <label>
          Labels (optional)
          <input bind:value={labels} placeholder="e.g. design" />
        </label>

        <label>
          Recent window (days)
          <input bind:value={sinceDays} type="number" min="1" step="1" />
        </label>

        <label>
          Reminder threshold (days)
          <input bind:value={reminderThresholdDays} type="number" min="1" step="1" />
        </label>

        <label>
          Tickets per page
          <input bind:value={pageSize} type="number" min="10" step="10" />
        </label>
      </div>

      <div class="buttons">
        <button class="primary-btn" on:click={loadIssues} disabled={loading}>
          {loading ? 'Loading…' : 'Load issues'}
        </button>
      </div>

      {#if debug}
        <div class="meta code-line">{debug}</div>
      {/if}
    </aside>

    <!-- Main Content Area (Compact Issue Feed) -->
    <div class="main-content">
      <section class="panel">
        <div class="section-title compact">
          <div>
            <h2>Issues</h2>
            <p class="meta">Page {currentPage} of {totalPages} ({totalIssues} total) in {OWNER}/{REPO}</p>
          </div>
          <div class="page-controls">
            <button on:click={() => goToPage(currentPage - 1)} disabled={loading || currentPage <= 1}>Previous</button>
            <button on:click={() => goToPage(currentPage + 1)} disabled={loading || currentPage >= totalPages}>Next</button>
          </div>
        </div>

        <div class="card-feed">
          {#if pageIssues.length === 0}
            <p class="empty-state">No issues loaded. Configure settings and click 'Load issues'.</p>
          {:else}
            {#each pageIssues as issue}
              <article class="issue-card">
                <div class="card-header">
                  <span class="mono index">#{issue.index}</span>
                  <a href={issue.html_url} target="_blank" rel="noreferrer" class="issue-title">
                    {issue.title}
                  </a>
                </div>

                <div class="card-meta">
                  <span><strong>Last comment:</strong> <span class="mono">{formatTimestamp(issue.last_comment_at ?? issue.updated_at)}</span></span>
                  <span class:late={getReminderTone(issue) === 'late'} class:soon={getReminderTone(issue) === 'soon'} class="countdown">
                    <strong>Reminder:</strong> {getReminderCountdown(issue)}
                  </span>
                  
                  {#if issue.assignees.length > 0}
                    <span><strong>Assignees:</strong> {issue.assignees.join(', ')}</span>
                  {/if}

                  {#if labelNames(issue).length > 0}
                    <div class="tag-list">
                      {#each labelNames(issue) as tag}
                        <span class="tag">{tag}</span>
                      {/each}
                    </div>
                  {/if}
                </div>
              </article>
            {/each}
          {/if}
        </div>
      </section>
    </div>

    <!-- Reminder Candidates Section -->
    {#if showReminders}
      <section class="panel reminders-panel">
        <div class="section-title compact">
          <div>
            <h2>Reminder candidates</h2>
            <p class="meta">Issues with no comments in the last {reminderThresholdDays} days.</p>
          </div>
        </div>

        {#if reminderIssues.length === 0}
          <p class="empty-state">No reminder candidates found.</p>
        {:else}
          <div class="reminder-feed">
            {#each reminderIssues as issue}
              <div class="reminder-card">
                <div class="card-header">
                  <a href={issue.html_url} target="_blank" rel="noreferrer" class="mono index">#{issue.index}</a>
                  <span class="issue-title">{issue.title}</span>
                </div>
                <div class="card-meta">
                  <small><strong>Last comment:</strong> <span class="mono">{formatTimestamp(issue.last_comment_at ?? issue.updated_at)}</span></small>
                  <small class:late={getReminderTone(issue) === 'late'} class:soon={getReminderTone(issue) === 'soon'} class="countdown">
                    <strong>Reminder:</strong> {getReminderCountdown(issue)}
                  </small>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  </div>
</main>

<style>
  .shell {
    max-width: 1280px;
    margin: 0 auto;
    padding: 24px 18px 44px;
    display: grid;
    gap: 20px;
  }

  .panel {
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(36, 74, 180, 0.12);
    border-radius: 24px;
    box-shadow: 0 18px 45px rgba(25, 47, 104, 0.09);
    backdrop-filter: blur(12px);
    padding: 20px;
  }

  /* Hero Section */
  .hero {
    display: grid;
    grid-template-columns: minmax(0, 1.55fr) minmax(260px, 0.85fr);
    gap: 18px;
    align-items: center;
    padding: 28px;
    position: relative;
    overflow: hidden;
    background:
      radial-gradient(circle at 12% 10%, rgba(164, 197, 255, 0.4), transparent 26%),
      radial-gradient(circle at 88% 20%, rgba(255, 255, 255, 0.28), transparent 18%),
      linear-gradient(135deg, #1d4ed8 0%, #2563eb 42%, #4f86ff 100%);
    border: 0;
    box-shadow: 0 22px 54px rgba(29, 78, 216, 0.22);
  }

  .hero-copy {
    position: relative;
    z-index: 1;
  }

  .eyebrow {
    display: inline-flex;
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.16);
    color: rgba(255, 255, 255, 0.96);
    border: 1px solid rgba(255, 255, 255, 0.22);
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 0.72rem;
    margin-bottom: 12px;
  }

  h1 {
    font-size: clamp(2.2rem, 5vw, 3.8rem);
    line-height: 0.98;
    letter-spacing: -0.04em;
    margin: 0 0 12px;
    color: white;
  }

  .hero-copy > p {
    color: rgba(255, 255, 255, 0.9);
    font-size: 1rem;
    line-height: 1.5;
    margin: 0;
  }

  .hero-stats {
    display: flex;
    gap: 12px;
    margin-top: 18px;
    flex-wrap: wrap;
  }

  .hero-stats div {
    padding: 10px 14px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.16);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .hero-stats strong {
    display: block;
    font-size: 1.4rem;
    color: white;
  }

  .hero-stats span {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.88);
  }

  .hero-stats div:nth-child(2) strong {
    font-size: 0.95rem;
    line-height: 1.35;
  }

  .hero-art img {
    width: min(100%, 260px);
    height: auto;
    background: rgba(255, 255, 255, 0.82);
    border-radius: 20px;
    padding: 10px;
  }

  /* Workspace Layout */
  .workspace {
    display: grid;
    grid-template-columns: 320px minmax(0, 1fr);
    gap: 20px;
    align-items: start;
  }

  .workspace.has-reminders {
    grid-template-columns: 320px minmax(0, 1fr) minmax(300px, 0.9fr);
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 14px;
    position: sticky;
    top: 20px;
  }

  .control-grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .main-content {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .reminders-panel {
    align-self: start;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: #3f506f;
    font-size: 0.88rem;
    font-weight: 600;
  }

  input,
  select {
    border: 1px solid rgba(39, 89, 203, 0.18);
    border-radius: 12px;
    padding: 10px 12px;
    background: rgba(247, 250, 255, 0.96);
    color: #13213c;
    font-size: 0.9rem;
  }

  .status {
    padding: 8px 12px;
    border-radius: 12px;
    background: rgba(37, 99, 235, 0.08);
    color: #17325f;
    font-size: 0.85rem;
    border: 1px solid rgba(37, 99, 235, 0.14);
  }

  .status.bad {
    background: rgba(220, 38, 38, 0.08);
    border-color: rgba(220, 38, 38, 0.16);
    color: #a61d1d;
  }

  .buttons {
    display: flex;
    gap: 10px;
  }

  button {
    border: 0;
    border-radius: 999px;
    padding: 10px 16px;
    background: #2563eb;
    color: white;
    font-weight: 600;
    font-size: 0.88rem;
    cursor: pointer;
  }

  .primary-btn {
    width: 100%;
    background: linear-gradient(135deg, #1d4ed8, #2563eb 55%, #4f86ff);
    padding: 12px;
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .section-title {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }

  .compact h2 {
    margin: 0;
    font-size: 1.25rem;
  }

  .meta {
    color: #62718d;
    font-size: 0.85rem;
    margin: 2px 0 0;
  }

  .page-controls {
    display: flex;
    gap: 8px;
  }

  /* Compact Cards */
  .card-feed,
  .reminder-feed {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 14px;
  }

  .issue-card,
  .reminder-card {
    padding: 14px 16px;
    border-radius: 14px;
    background: rgba(243, 247, 255, 0.7);
    border: 1px solid rgba(32, 72, 174, 0.1);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .card-header {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .issue-title {
    font-weight: 600;
    color: #1d4ed8;
    text-decoration: none;
  }

  .issue-title:hover {
    text-decoration: underline;
  }

  .card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    align-items: center;
    font-size: 0.82rem;
    color: #475569;
  }

  .countdown {
    padding: 4px 8px;
    border-radius: 999px;
    background: rgba(29, 78, 216, 0.08);
    border: 1px solid rgba(29, 78, 216, 0.12);
  }

  .countdown.soon {
    background: rgba(245, 158, 11, 0.1);
    border-color: rgba(245, 158, 11, 0.18);
    color: #9a5800;
  }

  .countdown.late {
    background: rgba(220, 38, 38, 0.08);
    border-color: rgba(220, 38, 38, 0.16);
    color: #a61d1d;
  }

  .tag-list {
    display: flex;
    gap: 6px;
  }

  .tag {
    background: rgba(37, 99, 235, 0.1);
    color: #1d4ed8;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 0.75rem;
  }

  .mono {
    font-family: monospace;
  }

  .empty-state {
    color: #64748b;
    font-size: 0.9rem;
    padding: 12px 0;
  }

  @media (max-width: 1080px) {
    .workspace {
      grid-template-columns: 1fr;
    }

    .hero {
      grid-template-columns: 1fr;
    }

    .sidebar {
      position: static;
    }

    .workspace.has-reminders {
      grid-template-columns: 1fr;
    }
  }
</style>