(() => {
  const q = (s) => document.querySelector(s);
  document.addEventListener('DOMContentLoaded', () => {
    const globalToggle = q('#globalToggle');
    const claudeToggle = q('#provider-claude-toggle');
    if (!globalToggle || !claudeToggle) return;

    const applyGlobal = (val) => {
      globalToggle.checked = !!val;
      claudeToggle.disabled = !val;
    };

    const applyClaude = (val) => {
      claudeToggle.checked = !!val;
    };

    try {
      chrome.storage.local.get({ timelineActive: true, timelineProviders: {} }, (res) => {
        const active = !!res.timelineActive;
        const claudeVal = (res.timelineProviders && typeof res.timelineProviders.claude === 'boolean') ? !!res.timelineProviders.claude : true;
        applyGlobal(active);
        applyClaude(claudeVal);
      });
    } catch {}

    globalToggle.addEventListener('change', () => {
      const enabled = !!globalToggle.checked;
      try { chrome.storage.local.set({ timelineActive: enabled }); } catch {}
      claudeToggle.disabled = !enabled;
    });

    claudeToggle.addEventListener('change', () => {
      const enabled = !!claudeToggle.checked;
      try {
        chrome.storage.local.get({ timelineProviders: {} }, (res) => {
          const map = res.timelineProviders || {};
          map.claude = enabled;
          try { chrome.storage.local.set({ timelineProviders: map }); } catch {}
        });
      } catch {}
    });
  });
})();
