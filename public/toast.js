(function () {
  'use strict';

  const ICONS = {
    success: '✓',
    error:   '✕',
    warning: '⚠',
    info:    'ℹ',
  };

  function getContainer() {
    let c = document.getElementById('vmm-toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'vmm-toast-container';
      c.className = 'toast-container';
      document.body.appendChild(c);
    }
    return c;
  }

  /**
   * Show a styled toast notification that auto-dismisses after 5s.
   * @param {string} message
   * @param {'success'|'error'|'warning'|'info'} type
   */
  window.showToast = function (message, type) {
    type = type || 'info';
    const container = getContainer();

    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.innerHTML =
      '<div class="toast-body">' +
        '<span class="toast-icon">' + (ICONS[type] || ICONS.info) + '</span>' +
        '<span class="toast-message">' + message + '</span>' +
      '</div>' +
      '<div class="toast-progress"></div>';

    container.appendChild(toast);

    function remove() {
      if (toast.classList.contains('leaving')) return;
      toast.classList.add('leaving');
      toast.addEventListener('animationend', function () { toast.remove(); }, { once: true });
    }

    const timer = setTimeout(remove, 5000);
    toast.addEventListener('click', function () { clearTimeout(timer); remove(); });
  };

  /**
   * Show a styled confirmation modal. Returns a Promise<boolean>.
   * Resolves true if confirmed, false if cancelled.
   * @param {string} message
   * @returns {Promise<boolean>}
   */
  window.showConfirm = function (message) {
    return new Promise(function (resolve) {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML =
        '<div class="confirm-modal">' +
          '<h3>Confirmation</h3>' +
          '<p>' + message + '</p>' +
          '<div class="confirm-actions">' +
            '<button class="confirm-btn cancel">Annuler</button>' +
            '<button class="confirm-btn danger">Confirmer</button>' +
          '</div>' +
        '</div>';

      document.body.appendChild(overlay);

      overlay.querySelector('.confirm-btn.cancel').addEventListener('click', function () {
        overlay.remove();
        resolve(false);
      });

      overlay.querySelector('.confirm-btn.danger').addEventListener('click', function () {
        overlay.remove();
        resolve(true);
      });

      // Close on overlay background click
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) {
          overlay.remove();
          resolve(false);
        }
      });
    });
  };
})();
