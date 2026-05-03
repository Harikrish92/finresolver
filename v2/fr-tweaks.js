// ── TWEAKS PANEL ──────────────────────────────────────────────────────────────
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#00e5a0",
  "density": "balanced",
  "sidebarCollapsed": false,
  "showLiveIndicator": true
}/*EDITMODE-END*/;

let tweaks = { ...TWEAK_DEFAULTS };

function applyTweaks() {
  document.documentElement.style.setProperty('--accent', tweaks.accent);
  // derive tinted versions
  const hex = tweaks.accent;
  document.documentElement.style.setProperty('--a10', hex + '1a');
  document.documentElement.style.setProperty('--a20', hex + '33');
  document.documentElement.style.setProperty('--a05', hex + '0d');

  if (tweaks.density === 'compact') {
    document.documentElement.style.setProperty('--topbar-h','52px');
    document.documentElement.style.fontSize = '13px';
  } else if (tweaks.density === 'spacious') {
    document.documentElement.style.setProperty('--topbar-h','72px');
    document.documentElement.style.fontSize = '15px';
  } else {
    document.documentElement.style.setProperty('--topbar-h','60px');
    document.documentElement.style.fontSize = '14px';
  }

  const liveEls = document.querySelectorAll('.live');
  liveEls.forEach(el => el.style.display = tweaks.showLiveIndicator ? '' : 'none');
}

function buildTweaksPanel() {
  const panel = document.createElement('div');
  panel.id = 'tweaks-panel';
  panel.className = 'hide';
  panel.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:400;
    background:var(--s1);border:1px solid var(--b2);border-radius:var(--rl);
    width:280px;box-shadow:var(--shadow);
    font-family:var(--font);overflow:hidden;
  `;

  const ACCENTS = [
    { label:'Emerald', val:'#00e5a0' },
    { label:'Sapphire', val:'#4dabf7' },
    { label:'Amber',   val:'#ffc947' },
    { label:'Violet',  val:'#a78bfa' },
    { label:'Coral',   val:'#ff5c7a' },
  ];

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--b)">
      <div style="font-family:var(--font-d);font-weight:700;font-size:13.5px;color:var(--t1);display:flex;align-items:center;gap:7px">
        ${ic('settings',13)} Tweaks
      </div>
      <button style="background:transparent;border:none;cursor:pointer;color:var(--t3);padding:2px" onclick="
        document.getElementById('tweaks-panel').classList.add('hide');
        window.parent.postMessage({type:'__edit_mode_dismissed'},'*')
      ">${ic('x',13)}</button>
    </div>

    <div style="padding:14px 16px;display:flex;flex-direction:column;gap:14px">

      <!-- Accent Color -->
      <div>
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--t3);margin-bottom:8px">Accent Color</div>
        <div style="display:flex;gap:6px">
          ${ACCENTS.map(a=>`
            <div onclick="tweaks.accent='${a.val}';applyTweaks();window.parent.postMessage({type:'__edit_mode_set_keys',edits:{accent:'${a.val}'}},'*')"
              style="width:28px;height:28px;border-radius:7px;background:${a.val};cursor:pointer;transition:.15s;border:2px solid transparent"
              title="${a.label}"
              onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform=''">
            </div>`).join('')}
        </div>
      </div>

      <!-- Density -->
      <div>
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--t3);margin-bottom:8px">Information Density</div>
        <div style="display:flex;gap:4px;background:var(--s2);border-radius:8px;padding:3px;border:1px solid var(--b)">
          ${['compact','balanced','spacious'].map(d=>`
            <button id="tw-density-${d}" onclick="tweaks.density='${d}';applyTweaks();updateDensityBtns();window.parent.postMessage({type:'__edit_mode_set_keys',edits:{density:'${d}'}},'*')"
              style="flex:1;padding:5px;border:none;border-radius:6px;font-size:11.5px;font-weight:500;cursor:pointer;font-family:var(--font);transition:.15s;background:${tweaks.density===d?'var(--s1)':'transparent'};color:${tweaks.density===d?'var(--t1)':'var(--t3)'}">
              ${d.charAt(0).toUpperCase()+d.slice(1)}
            </button>`).join('')}
        </div>
      </div>

      <!-- Theme -->
      <div>
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--t3);margin-bottom:8px">Theme</div>
        <div style="display:flex;gap:4px;background:var(--s2);border-radius:8px;padding:3px;border:1px solid var(--b)">
          ${['dark','light'].map(t=>`
            <button onclick="APP.theme='${t}';localStorage.setItem('fr_theme','${t}');document.body.classList.toggle('light','${t}'==='light');updateThemeBtns()"
              id="tw-theme-${t}"
              style="flex:1;padding:5px;border:none;border-radius:6px;font-size:11.5px;font-weight:500;cursor:pointer;font-family:var(--font);transition:.15s;background:${APP.theme===t?'var(--s1)':'transparent'};color:${APP.theme===t?'var(--t1)':'var(--t3)'}">
              ${t.charAt(0).toUpperCase()+t.slice(1)}
            </button>`).join('')}
        </div>
      </div>

      <!-- Show Live Indicator -->
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:12.5px;font-weight:500;color:var(--t2)">Show Live Indicator</div>
        <div onclick="tweaks.showLiveIndicator=!tweaks.showLiveIndicator;applyTweaks();this.setAttribute('data-on',tweaks.showLiveIndicator)"
          data-on="true"
          style="width:36px;height:20px;border-radius:999px;cursor:pointer;transition:.2s;position:relative;background:var(--accent)"
          id="tw-live-toggle">
          <div style="position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#070c17;transition:.2s;transform:translateX(16px)" id="tw-live-thumb"></div>
        </div>
      </div>

      <div style="height:1px;background:var(--b)"></div>

      <!-- Navigate -->
      <div>
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--t3);margin-bottom:8px">Quick Navigate</div>
        <div style="display:flex;flex-direction:column;gap:3px">
          ${[['dashboard','Dashboard'],['monthly','Monthly Tracker'],['investments','Investments'],['loans','Loans'],['portfolio','Portfolio & FIRE']].map(([s,l])=>`
            <button onclick="navigate('${s}');document.getElementById('tweaks-panel').classList.add('hide');window.parent.postMessage({type:'__edit_mode_dismissed'},'*')"
              style="background:transparent;border:none;text-align:left;padding:7px 8px;border-radius:var(--rs);cursor:pointer;font-size:12.5px;font-weight:500;color:var(--t2);font-family:var(--font);transition:.15s"
              onmouseover="this.style.background='var(--s3)';this.style.color='var(--t1)'"
              onmouseout="this.style.background='transparent';this.style.color='var(--t2)'">${l}</button>`).join('')}
        </div>
      </div>

    </div>`;

  document.body.appendChild(panel);

  // Live toggle logic
  document.getElementById('tw-live-toggle')?.addEventListener('click', function() {
    const on = this.getAttribute('data-on') === 'true';
    const thumb = document.getElementById('tw-live-thumb');
    if (on) { this.style.background='var(--s4)'; thumb.style.transform='translateX(0)'; }
    else    { this.style.background='var(--accent)'; thumb.style.transform='translateX(16px)'; }
  });
}

function updateDensityBtns() {
  ['compact','balanced','spacious'].forEach(d => {
    const btn = document.getElementById('tw-density-'+d);
    if (!btn) return;
    btn.style.background = tweaks.density===d ? 'var(--s1)' : 'transparent';
    btn.style.color      = tweaks.density===d ? 'var(--t1)' : 'var(--t3)';
  });
}

function updateThemeBtns() {
  ['dark','light'].forEach(t => {
    const btn = document.getElementById('tw-theme-'+t);
    if (!btn) return;
    btn.style.background = APP.theme===t ? 'var(--s1)' : 'transparent';
    btn.style.color      = APP.theme===t ? 'var(--t1)' : 'var(--t3)';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  buildTweaksPanel();
  applyTweaks();
});
