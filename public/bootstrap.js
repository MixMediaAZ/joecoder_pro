async function exchangeToken() {
      const statusEl = document.getElementById('status');
      const resultEl = document.getElementById('result');
      const retryBtn = document.getElementById('retry-btn');
      const contentEl = document.getElementById('result-content');

      statusEl.className = 'status loading';
      statusEl.textContent = 'Exchanging bootstrap token...';
      resultEl.classList.add('hidden');
      retryBtn.classList.add('hidden');

      // Get token from URL fragment
      const hash = window.location.hash;
      const tokenMatch = hash.match(/token=([a-f0-9]{64})/);

      if (!tokenMatch) {
        statusEl.className = 'status error';
        statusEl.textContent = 'No valid bootstrap token found in URL';
        retryBtn.classList.remove('hidden');
        return;
      }

      const bootstrapToken = tokenMatch[1];

      try {
        const response = await fetch('/api/v1/session/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bootstrapToken })
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Exchange failed');
        }

        // Success: the opaque session stays in an HttpOnly cookie. Only now is
        // the one-time token cleared from the URL — clearing it before the
        // exchange succeeded made Try Again reload a tokenless page, which
        // could never recover from a transient failure.
        history.replaceState(null, '', '/bootstrap.html');
        statusEl.className = 'status success';
        statusEl.textContent = 'Session established successfully';

        contentEl.textContent = JSON.stringify({
          sessionId: data.sessionId,
          idleExpiresIn: data.idleExpiresIn,
          absoluteExpiresIn: data.absoluteExpiresIn,
          message: data.message
        }, null, 2);

        resultEl.classList.remove('hidden');


        // Auto-enter workspace after a short pause (user can still click)
        setTimeout(function () {
          window.location.href = '/app.html';
        }, 1200);

      } catch (err) {
        statusEl.className = 'status error';
        statusEl.textContent = 'Failed to establish session';
        contentEl.textContent = err.message +
          '\n\nTry Again re-attempts with the same one-time token. If it has expired (60 seconds) or was already used, restart the JoeCoder service to print a fresh bootstrap URL.';
        resultEl.classList.remove('hidden');
        retryBtn.classList.remove('hidden');
      }
    }

    function retry() {
      window.location.reload();
    }

    // Auto-run on page load
    window.onload = exchangeToken;

document.getElementById('retry-btn').addEventListener('click', retry);
