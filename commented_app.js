// Importation des modules
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = 4000;

// Charger le certificat auto-signé pour HTTPS
const httpsOptions = {
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem'),
};

// Middleware
app.use(cors({
  origin: 'https://192.168.0.56', // Origine autorisée (frontend)
  credentials: true, // Autoriser les cookies
}));
app.use(express.json()); // Permet de traiter les requêtes avec un corps JSON
app.use(cookieParser()); // Middleware pour gérer les cookies

// Agent HTTPS pour accepter les certificats auto-signés
const httpsAgent = new https.Agent({
  rejectUnauthorized: false, // Accepter les certificats non validés
});

// Rediriger la route de base vers la page de connexion
app.get('/', (req, res) => {
  res.redirect('/login');
});

// Servir les fichiers statiques (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// Routes pour servir les pages HTML
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/clone-vm', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'clone_vm.html'));
});

app.get('/new-vm', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'new_vm.html'));
});

app.get('/del-vm', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'del_vm.html'));
});

// Route d'authentification
app.post('/authenticate', async (req, res) => {
  const { username, password } = req.body;

  const PROXMOX_API_URL = 'https://192.168.0.56:8006/api2/json/access/ticket';

  try {
    const response = await fetch(PROXMOX_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password }),
      agent: new https.Agent({ rejectUnauthorized: false }),
    });

    if (response.ok) {
      const data = await response.json();

      // Créer un cookie contenant les identifiants encodés en base64
      const credentials = Buffer.from(`${username}:${password}`).toString('base64');
      res.cookie('userCredentials', credentials, {
        httpOnly: false, // Empêcher l'accès via JavaScript côté client
        secure: true, // Nécessite HTTPS
        sameSite: 'Strict', // Protéger contre les attaques CSRF
        maxAge: 86400 * 1000, // Valide pendant 1 jour
        path: '/',
      });

      res.status(200).json({ message: 'Connexion réussie', ticket: data.data.ticket });
    } else {
      const error = await response.json();
      res.status(401).json({ message: 'Authentification échouée', error });
    }
  } catch (error) {
    res.status(500).json({ message: 'Erreur réseau ou serveur', error: error.message });
  }
});

// Route pour récupérer les permissions depuis l'API Proxmox
app.get('/permissions', async (req, res) => {
  const { username, password } = req.query;

  if (!username || !password) {
    return res.status(400).send("Erreur : Identifiant ou mot de passe manquant.");
  }

  try {
    // Étape 1 : Authentification auprès de Proxmox
    const authResponse = await axios.post(
      'https://192.168.0.56:8006/api2/json/access/ticket',
      new URLSearchParams({ username, password }),
      { httpsAgent }
    );

    const { ticket, CSRFPreventionToken } = authResponse.data.data;

    // Étape 2 : Récupérer les permissions de l'utilisateur
    const permissionsResponse = await axios.get(
      'https://192.168.0.56:8006/api2/json/access/permissions',
      {
        headers: {
          Cookie: `PVEAuthCookie=${ticket}`,
          CSRFPreventionToken,
        },
        httpsAgent,
      }
    );

    permissions = permissionsResponse.data.data;

    // Étape 3 : Retourner les permissions
    res.json(permissions);
  } catch (error) {
    console.error('Erreur lors de la récupération des permissions :', error.response?.data || error.message);
    console.error('Erreur complète :', error.toJSON ? error.toJSON() : error);
    res.status(500).json({
      message: 'Une erreur est survenue lors de la récupération des permissions.',
      error: error.response?.data || error.message,
    });
  }
});

// Route pour récupérer les VMs accessibles par l'utilisateur
app.get('/vms', async (req, res) => {
  const { username, password } = req.query;

  if (!username || !password) {
    return res.status(400).send('Erreur : Identifiant ou mot de passe manquant.');
  }

  try {
    // Authentification utilisateur
    const ticketResponse = await axios.post(
      'https://192.168.0.56:8006/api2/json/access/ticket',
      new URLSearchParams({ username, password }),
      { httpsAgent }
    );

    const ticket = ticketResponse.data.data.ticket;
    const csrfToken = ticketResponse.data.data.CSRFPreventionToken;

    // Ajouter un cookie pour le ticket PVE
    res.cookie('PVEAuthCookie', ticket, {
      path: '/',
      httpOnly: false,
      secure: true,
      maxAge: 1000 * 60 * 60 * 24, // 24 heures
    });

    // Récupérer les groupes de l'utilisateur
    const groupResponse = await axios.get(
      'https://192.168.0.56:8006/api2/json/access/groups',
      {
        headers: {
          Cookie: `PVEAuthCookie=${ticket}`,
          CSRFPreventionToken: csrfToken,
        },
        httpsAgent,
      }
    );

    const groups = groupResponse.data.data;
    const userGroups = groups
      .filter(group => group.users.includes(username))
      .map(group => group.groupid);

    if (!userGroups === 0) {
      console.error("Erreur : Aucun groupe trouvé pour l'utilisateur.");
      return res.status(403).send("Erreur : Accès interdit. Aucun groupe associé.");
    }

    const hasAccessToAll = userGroups.includes("all");

    // Récupération des ressources (VMs)
    const resourcesResponse = await axios.get(
      "https://192.168.0.56:8006/api2/json/cluster/resources",
      {
        headers: {
          Cookie: `PVEAuthCookie=${ticket}`,
          CSRFPreventionToken: csrfToken,
        },
        httpsAgent,
      }
    );

    const allResources = resourcesResponse.data.data;

    let vms;

    if (hasAccessToAll) {
      // Si l'utilisateur a accès à toutes les VMs
      vms = allResources
        .filter(vm => vm.type === "qemu")
        .map(vm => ({
          vmid: vm.vmid,
          name: vm.name,
          maxcpu: vm.maxcpu,
          maxmem: (vm.maxmem / 1024 / 1024 / 1024).toFixed(2),
          maxdisk: (vm.maxdisk / 1024 / 1024 / 1024).toFixed(2),
          status: vm.status,
          tags: vm.tags,
        }));
    } else {
      // Filtrer les VMs en fonction des tags multiples et des groupes de l'utilisateur
      vms = allResources
        .filter(vm => {
          if (vm.type !== "qemu" || !vm.tags) return false;

          // Diviser les tags multiples de la VM (ex. séparés par ";")
          const vmTags = vm.tags.split(';').map(tag => tag.trim());

          // Vérifier si au moins un des tags correspond à un groupe de l'utilisateur
          return vmTags.some(tag => userGroups.includes(tag));
        })
        .map(vm => ({
          vmid: vm.vmid,
          name: vm.name,
          maxcpu: vm.maxcpu,
          maxmem: (vm.maxmem / 1024 / 1024 / 1024).toFixed(2),
          maxdisk: (vm.maxdisk / 1024 / 1024 / 1024).toFixed(2),
          status: vm.status,
          tags: vm.tags,
        }));
    }

    res.json(vms);
  } catch (error) {
    console.error("Erreur lors de la récupération des VMs :", error.response?.data || error.message);
    res.status(500).send("Erreur lors de la récupération des données des VMs");
  }
});

// Route pour démarrer une VM
app.post('/vms/:vmid/start', async (req, res) => {
  const { vmid } = req.params;
  const { username, password } = req.query;

  if (!username || !password) {
    return res.status(400).send('Erreur : Identifiant ou mot de passe manquant.');
  }

  try {
    const ticketResponse = await axios.post(
      'https://192.168.0.56:8006/api2/json/access/ticket',
      new URLSearchParams({
        username, 
        password 
      }),
      { httpsAgent }
    );

    const { ticket, CSRFPreventionToken } = ticketResponse.data.data;

    await axios.post(
      `https://192.168.0.56:8006/api2/json/nodes/servali/qemu/${vmid}/status/start`,
      {},
      {
        headers: {
          Cookie: `PVEAuthCookie=${ticket}`,
          CSRFPreventionToken,
        },
        httpsAgent,
      }
    );

    res.status(200).send(`VM ${vmid} démarrée avec succès.`);
  } catch (error) {
    console.error(`Erreur lors du démarrage de la VM ${vmid}:`, error.message);
    res.status(500).send(`Erreur lors du démarrage de la VM ${vmid}.`);
  }
});

// Route pour arrêter une VM
app.post('/vms/:vmid/stop', async (req, res) => {
  const { vmid } = req.params;
  const { username, password } = req.query;

  if (!username || !password) {
    return res.status(400).send('Erreur : Identifiant ou mot de passe manquant.');
  }

  try {
    const ticketResponse = await axios.post(
      'https://192.168.0.56:8006/api2/json/access/ticket',
      new URLSearchParams({
        username, 
        password 
      }),
      { httpsAgent }
    );

    const { ticket, CSRFPreventionToken } = ticketResponse.data.data;

    await axios.post(
      `https://192.168.0.56:8006/api2/json/nodes/servali/qemu/${vmid}/status/stop`,
      {},
      {
        headers: {
          Cookie: `PVEAuthCookie=${ticket}`,
          CSRFPreventionToken,
        },
        httpsAgent,
      }
    );

    res.status(200).send(`VM ${vmid} arrêtée avec succès.`);
  } catch (error) {
    console.error(`Erreur lors de l'arrêt de la VM ${vmid}:`, error.message);
    res.status(500).send(`Erreur lors de l'arrêt de la VM ${vmid}.`);
  }
});

// Route pour récupérer toutes les Vms
app.get('/all-vms', async (req, res) => {
  const { username, password } = req.query;

  if (!username || !password) {
      return res.status(400).json({ message: 'Identifiant ou mot de passe manquant.' });
  }

  try {
      const ticketResponse = await axios.post(
          "https://192.168.0.56:8006/api2/json/access/ticket",
          new URLSearchParams({ username, password }),
          { httpsAgent }
      );

      const ticket = ticketResponse.data.data.ticket;

      const resourcesResponse = await axios.get(
          "https://192.168.0.56:8006/api2/json/cluster/resources",
          {
              headers: {
                  Cookie: `PVEAuthCookie=${ticket}`,
              },
              httpsAgent,
          }
      );

      const vms = resourcesResponse.data.data
          .filter(vm => vm.type === 'qemu')
          .map(vm => ({
              vmid: vm.vmid,
              name: vm.name,
              maxcpu: vm.maxcpu,
              maxmem: (vm.maxmem / 1024 / 1024 / 1024).toFixed(2),
              maxdisk: (vm.maxdisk / 1024 / 1024 / 1024).toFixed(2),
              status: vm.status,
          }));

      res.json(vms);
  } catch (error) {
      console.error('Erreur lors de la récupération des VMs :', error.response?.data || error.message);
      res.status(500).send('Erreur lors de la récupération des données des VMs');
  }
});

// Route pour cloner des VMs
app.post('/clone-vm', async (req, res) => {
  const { sourceVmid, newVmid, newVmName } = req.body;
  const { username, password } = req.query;

  if (!username || !password || !sourceVmid || !newVmid || !newVmName) {
    return res.status(400).json({ message: 'Tous les champs sont requis.' });
  }

  try {
    // Étape 1 : Authentification auprès de Proxmox
    const authResponse = await axios.post(
      'https://192.168.0.56:8006/api2/json/access/ticket',
      new URLSearchParams({ username, password }),
      { httpsAgent }
    );

    const { ticket, CSRFPreventionToken } = authResponse.data.data;

    // Étape 2 : Envoyer la requête pour cloner la VM
    const cloneResponse = await axios.post(
      `https://192.168.0.56:8006/api2/json/nodes/servali/qemu/${sourceVmid}/clone`,
      new URLSearchParams({
        newid: newVmid,
        name: newVmName,
      }),
      {
        headers: {
          Cookie: `PVEAuthCookie=${ticket}`,
          CSRFPreventionToken,
        },
        httpsAgent,
      }
    );

    // Étape 3 : Modifier les tags de la nouvelle VM
    const updateTagsResponse = await axios.put(
      `https://192.168.0.56:8006/api2/json/nodes/servali/qemu/${newVmid}/config`,
      new URLSearchParams({
        tags: 'sae', // Remplacer les tags par 'sae'
      }),
      {
        headers: {
          Cookie: `PVEAuthCookie=${ticket}`,
          CSRFPreventionToken,
        },
        httpsAgent,
      }
    );

    res.status(200).json({
      message: `La VM ${newVmName} (ID: ${newVmid}) a été clonée avec succès et ses tags ont été mis à jour.`,
      cloneData: cloneResponse.data,
      tagUpdateData: updateTagsResponse.data,
    });
  } catch (error) {
    console.error('Erreur lors du clonage de la VM ou de la mise à jour des tags :', error.response?.data || error.message);
    res.status(500).json({
      message: 'Une erreur est survenue lors du clonage de la VM ou de la mise à jour des tags.',
      error: error.response?.data || error.message,
    });
  }
});

// Route pour récupérer les iso disponibles sur le proxmox
app.get('/iso-list', async (req, res) => {
  const { username, password } = req.query;

  if (!username || !password) {
      return res.status(400).json({ message: 'Identifiant ou mot de passe manquant.' });
  }

  try {
      const ticketResponse = await axios.post(
          "https://192.168.0.56:8006/api2/json/access/ticket",
          new URLSearchParams({ username, password }),
          { httpsAgent }
      );

      const ticket = ticketResponse.data.data.ticket;

      const isoUrl = `https://192.168.0.56:8006/api2/json/nodes/servali/storage/local/content`;

      const isoResponse = await axios.get(isoUrl, {
          headers: {
              Cookie: `PVEAuthCookie=${ticket}`,
          },
          httpsAgent,
      });

      const isoFiles = isoResponse.data.data.filter(file => file.content === 'iso');
      res.status(200).json(isoFiles);
  } catch (error) {
      console.error('Erreur lors de la récupération des ISO :', error.response?.data || error.message);
      res.status(500).send('Erreur lors de la récupération des ISO.');
  }
});

// Route pour créer une nouvelle VM
app.post('/new-vm', async (req, res) => {
  const { username, password, vmid, name, diskSize, isoImage, sockets, cores, memory, tags } = req.body;

  if (!username || !password) {
      return res.status(400).json({ message: 'Identifiant ou mot de passe manquant.' });
  }

  try {
      const authResponse = await axios.post(
          "https://192.168.0.56:8006/api2/json/access/ticket",
          new URLSearchParams({ username, password }),
          { httpsAgent }
      );

      const { ticket, CSRFPreventionToken } = authResponse.data.data;

      const createVmUrl = `https://192.168.0.56:8006/api2/json/nodes/servali/qemu`;

      const params = new URLSearchParams({
          vmid,
          name,
          memory,
          sockets,
          cores,
          net0: `virtio,bridge=vmbr0,firewall=1`,
          cpu: `host`,
      });

      if (isoImage) params.append('cdrom', isoImage);
      if (diskSize) params.append('scsi0', `local-lvm:${diskSize}`);
      if (tags && Array.isArray(tags)) {
        params.append('tags', tags.join(','));
      }

      const createVmResponse = await axios.post(createVmUrl, params, {
          headers: {
              Cookie: `PVEAuthCookie=${ticket}`,
              CSRFPreventionToken,
          },
          httpsAgent,
      });

      res.status(200).json({ message: 'VM créée avec succès.', data: createVmResponse.data });
  } catch (error) {
      console.error('Erreur lors de la création de la VM :', error.response?.data || error.message);
      res.status(500).send('Erreur lors de la création de la VM.');
  }
});

// Route pour supprimer une VM
app.delete('/vms/:vmid', async (req, res) => {
  const { username, password } = req.query;
  const { vmid } = req.params;

  if (!username || !password) {
    return res.status(400).send("Erreur : Identifiant ou mot de passe manquant.");
  }

  try {
    const ticketResponse = await axios.post(
      "https://192.168.0.56:8006/api2/json/access/ticket",
      new URLSearchParams({
        username,
        password,
      }),
      { httpsAgent }
    );

    const { ticket, CSRFPreventionToken } = ticketResponse.data.data;

    const deleteVmResponse = await axios.delete(
      `https://192.168.0.56:8006/api2/json/nodes/servali/qemu/${vmid}`,
      {
        headers: {
          Cookie: `PVEAuthCookie=${ticket}`,
          CSRFPreventionToken,
        },
        httpsAgent,
      }
    );

    if (deleteVmResponse.status === 200) {
      return res.status(200).send(`VM ${vmid} supprimée avec succès.`);
    } else {
      throw new Error(`Erreur lors de la suppression de la VM ${vmid}.`);
    }
  } catch (error) {
    console.error(`Erreur lors de la suppression de la VM ${vmid}:`, error.message);
    res.status(500).send(`Erreur lors de la suppression de la VM ${vmid}.`);
  }
});

// Route pour se déconnecter
app.post('/logout', (req, res) => {
  res.clearCookie('PVEAuthCookie', { path: '/', domain: '192.168.0.56', secure: true });
  res.clearCookie('userCredentials', { path: '/', domain: '192.168.0.56', secure: true });
  res.redirect('/');
});

// Lancer le serveur HTTPS
https.createServer(httpsOptions, app).listen(PORT, () => {
  console.log(`Server running on https://localhost:${PORT}`);
});
