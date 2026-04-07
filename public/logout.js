document.getElementById('logout').addEventListener('click', async () => {
  try {
    await fetch('/logout', { method: 'POST', credentials: 'include' });
    sessionStorage.clear();
    window.location.href = '/';
  } catch (error) {
    console.error('Erreur lors de la déconnexion :', error);
  }
});
