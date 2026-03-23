document.getElementById('logout').addEventListener('click', async () => {
  try {
    // Appeler la route de déconnexion
    await fetch('https://192.168.1.42:4000/logout', { method: 'POST', credentials: 'include' });

    // Vider le sessionStorage
    sessionStorage.clear();

    // Rediriger vers la page d'accueil
    window.location.href = '/';
  } catch (error) {
    console.error('Erreur lors de la déconnexion :', error);
  }
});
