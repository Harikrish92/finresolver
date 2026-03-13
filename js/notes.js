/* ============================================================
   notes.js — Monthly notes: render, inline edit, pin, delete
   FinResolver · finresolver.in

   Notes are stored per-month inside data.notes as:
   { id: timestamp, text: string, pinned: bool, createdAt: ISO, editedAt?: ISO }

   Called from render() in render.js via renderNotes().
   CRUD functions live in tracker.js (addNote, deleteNote, etc.)
   ============================================================ */

/* ── Inject styles once ──────────────────────────────────── */
(function injectNotesStyles() {
  if (document.getElementById('notes-styles')) return;
  const style = document.createElement('style');
  style.id = 'notes-styles';
  style.textContent = `
    .notes-section { margin-top: 1.75rem; }

    .notes-add-row {
      display: flex;
      gap: .5rem;
      margin-bottom: 1rem;
      align-items: flex-start;
      margin-top: 1rem;
    }
    .notes-add-row textarea {
      flex: 1;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: .8rem;
      padding: .6rem .85rem;
      border-radius: 8px;
      resize: none;
      min-height: 56px;
      line-height: 1.55;
      transition: border-color .2s;
    }
    .notes-add-row textarea:focus {
      outline: none;
      border-color: var(--purple);
    }
    .notes-add-row textarea::placeholder { color: var(--muted); }
    .btn-note-add {
      background: var(--purple);
      color: #fff;
      border: none;
      font-family: var(--font-head);
      font-size: .75rem;
      font-weight: 700;
      padding: .55rem 1rem;
      border-radius: 8px;
      cursor: pointer;
      white-space: nowrap;
      transition: opacity .15s, transform .1s;
      align-self: flex-end;
    }
    .btn-note-add:hover { opacity: .85; transform: scale(1.03); }

    .notes-empty {
      color: var(--muted);
      font-size: .78rem;
      text-align: center;
      padding: 1.5rem 0;
      opacity: .5;
    }

    .notes-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: .75rem;
    }

    .note-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: .9rem 1rem;
      position: relative;
      transition: border-color .2s, transform .15s;
      animation: fadeUp .3s ease both;
      display: flex;
      flex-direction: column;
      gap: .5rem;
    }
    .note-card:hover { transform: translateY(-2px); border-color: rgba(167,139,250,.35); }
    .note-card.pinned {
      border-color: rgba(167,139,250,.55);
      background: rgba(167,139,250,.06);
    }
    .note-card.pinned::after {
      content: '📌';
      position: absolute;
      top: .55rem;
      right: .6rem;
      font-size: .8rem;
      pointer-events: none;
    }

    .note-meta {
      font-size: .63rem;
      color: var(--muted);
      display: flex;
      align-items: center;
      gap: .4rem;
    }
    .note-meta .note-edited { font-style: italic; opacity: .6; }

    .note-text {
      font-size: .8rem;
      line-height: 1.6;
      color: var(--text);
      white-space: pre-wrap;
      word-break: break-word;
      outline: none;
      border-radius: 5px;
      flex: 1;
    }
    .note-text.editing {
      background: var(--surface2);
      border: 1px solid var(--purple);
      padding: .35rem .5rem;
      border-radius: 6px;
    }

    .note-actions {
      display: flex;
      gap: .3rem;
      justify-content: flex-end;
      opacity: 0;
      transition: opacity .15s;
    }
    .note-card:hover .note-actions { opacity: 1; }

    .note-action-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--muted);
      font-size: .68rem;
      padding: .22rem .5rem;
      border-radius: 5px;
      cursor: pointer;
      font-family: var(--font-mono);
      transition: background .15s, color .15s, border-color .15s;
    }
    .note-action-btn:hover { background: var(--surface2); color: var(--text); }
    .note-action-btn.pin-active { color: var(--purple); border-color: rgba(167,139,250,.4); }
    .note-action-btn.del-btn:hover { color: var(--accent2); border-color: rgba(255,107,107,.4); }

    .note-edit-row {
      display: none;
      gap: .4rem;
      justify-content: flex-end;
    }
    .note-save-btn {
      background: var(--purple);
      color: #fff;
      border: none;
      font-size: .7rem;
      font-family: var(--font-head);
      font-weight: 700;
      padding: .28rem .65rem;
      border-radius: 5px;
      cursor: pointer;
    }
    .note-cancel-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--muted);
      font-size: .7rem;
      font-family: var(--font-mono);
      padding: .28rem .6rem;
      border-radius: 5px;
      cursor: pointer;
    }
  `;
  document.head.appendChild(style);
})();

/* ── Render ──────────────────────────────────────────────── */
function renderNotes() {
  const container = document.getElementById('notesGrid');
  if (!container) return;

  if (!Array.isArray(data.notes)) data.notes = [];

  if (!data.notes.length) {
    container.innerHTML = `<div class="notes-empty">No notes yet — jot down key findings, reminders or goals for this month</div>`;
    return;
  }

  container.innerHTML = data.notes.map(note => {
    const date   = new Date(note.createdAt);
    const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                  + ', ' + date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const editedStr = note.editedAt
      ? `<span class="note-edited"> · edited</span>`
      : '';

    return `
      <div class="note-card ${note.pinned ? 'pinned' : ''}" id="note-${note.id}">
        <div class="note-meta">
          <span>${dateStr}</span>${editedStr}
        </div>
        <div class="note-text"
             id="note-text-${note.id}"
             spellcheck="false">${escHtml(note.text)}</div>
        <div class="note-edit-row" id="note-edit-row-${note.id}">
          <button class="note-cancel-btn" onclick="cancelEditNote(${note.id})">Cancel</button>
          <button class="note-save-btn"   onclick="saveEditNote(${note.id})">Save</button>
        </div>
        <div class="note-actions" id="note-actions-${note.id}">
          <button class="note-action-btn ${note.pinned ? 'pin-active' : ''}"
                  onclick="togglePinNote(${note.id})"
                  title="${note.pinned ? 'Unpin' : 'Pin note'}">
            ${note.pinned ? '📌 Pinned' : '📌 Pin'}
          </button>
          <button class="note-action-btn"
                  onclick="startEditNote(${note.id})"
                  title="Edit note">✏️ Edit</button>
          <button class="note-action-btn del-btn"
                  onclick="deleteNote(${note.id})"
                  title="Delete note">✕</button>
        </div>
      </div>`;
  }).join('');
}
