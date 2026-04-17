const express = require('express');
const axios = require('axios');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const fetch = require('node-fetch');
const path = require('path');
const http = require('http');

function loadConf(filepath) {
  const raw = fs.readFileSync(filepath, 'utf8');
  const conf = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    conf[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return conf;
}

const conf = loadConf(path.join(__dirname, 'vmm.conf'));
const IP   = conf.IP;
const PORT = parseInt(conf.PORT, 10) || 4000;

const app = express();

const httpsOptions = {
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem'),
};

app.use(cors({
  origin: `https://${IP}`,
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

// Redirection HTTP → HTTPS
http.createServer((req, res) => {
  // récupère le host demandé
  const host = req.headers['host'];

  // reconstruit l’URL avec https et le port HTTPS que tu utilises
  res.writeHead(301, {
    "Location": "https://" + host.replace(/:\d+$/, '') + ":" + PORT + req.url
  });
  res.end();
}).listen(80, () => {
  console.log("Redirection HTTP → HTTPS active sur le port 80");
});

app.get('/', (req, res) => {
  res.redirect('/login');
});

app.use(express.static(path.join(__dirname, 'public')));

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

app.post('/authenticate', async (req, res) => {
  const { username, password } = req.body;

  const PROXMOX_API_URL = `https://${IP}:8006/api2/json/access/ticket`;

  try {
      const response = await fetch(PROXMOX_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ username, password }),
          agent: new https.Agent({
              rejectUnauthorized: false
          })
      });

      if (response.ok) {
          const data = await response.json();

          const credentials = Buffer.from(`${username}:${password}`).toString('base64');
          res.cookie('userCredentials', credentials, {
              httpOnly: false,
              secure: true,
              sameSite: 'Strict',
              maxAge: 86400 * 1000,
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

app.get('/nodes', async (req, res) => {
  const { username, password } = req.query;

  if (!username || !password) {
    return res.status(400).json({ message: 'Identifiant ou mot de passe manquant.' });
  }

  try {
    const authResponse = await axios.post(
      `https://${IP}:8006/api2/json/access/ticket`,
      new URLSearchParams({ username, password }),
      { httpsAgent }
    );

    const { ticket, CSRFPreventionToken } = authResponse.data.data;

    const nodesResponse = await axios.get(
      `https://${IP}:8006/api2/json/nodes`,
      {
        headers: {
          Cookie: `PVEAuthCookie=${ticket}`,
          CSRFPreventionToken,
        },
        httpsAgent,
      }
    );

    const nodes = nodesResponse.data.data.map(n => ({
      node:      n.node,
      status:    n.status,
      maxcpu:    n.maxcpu,
      maxmem:    +(n.maxmem  / 1024 / 1024 / 1024).toFixed(2),
      mem:       +(n.mem     / 1024 / 1024 / 1024).toFixed(2),
      maxdisk:   +(n.maxdisk / 1024 / 1024 / 1024).toFixed(2),
      disk:      +(n.disk    / 1024 / 1024 / 1024).toFixed(2),
      uptime:    n.uptime,
    }));

    res.json(nodes);
  } catch (error) {
    console.error('Erreur lors de la récupération des nodes :', error.response?.data || error.message);
    res.status(500).json({ message: 'Erreur lors de la récupération des nodes.', error: error.response?.data || error.message });
  }
});

app.get('/permissions', async (req, res) => {
  const { username, password } = req.query;

  if (!username || !password) {
    return res.status(400).send("Erreur : Identifiant ou mot de passe manquant.");
  }

  try {
    const authResponse = await axios.post(
      `https://${IP}:8006/api2/json/access/ticket`,
      new URLSearchParams({ username, password }),
      { httpsAgent }
    );

    const { ticket, CSRFPreventionToken } = authResponse.data.data;

    const permissionsResponse = await axios.get(
      `https://${IP}:8006/api2/json/access/permissions`,
      {
        headers: {
          Cookie: `PVEAuthCookie=${ticket}`,
          CSRFPreventionToken,
        },
        httpsAgent,
      }
    );

    permissions = permissionsResponse.data.data;

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

app.get('/vms', async (req, res) => {
  const { username, password } = req.query;

  if (!username || !password) {
    return res.status(400).send("Erreur : Identifiant ou mot de passe manquant.");
  }

  try {
    const ticketResponse = await axios.post(
      `https://${IP}:8006/api2/json/access/ticket`,
      new URLSearchParams({ username, password }),
      { httpsAgent }
    );

    const ticket = ticketResponse.data.data.ticket;
    const csrfToken = ticketResponse.data.data.CSRFPreventionToken;

    res.cookie('PVEAuthCookie', ticket, {
      path: '/',
      httpOnly: false,
      secure: true,
      maxAge: 1000 * 60 * 60 * 24,
    });

    const groupResponse = await axios.get(
      `https://${IP}:8006/api2/json/access/groups`,
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

    if (userGroups.length === 0) {
      console.error("Erreur : Aucun groupe trouvé pour l'utilisateur.");
      return res.status(403).send("Erreur : Accès interdit. Aucun groupe associé.");
    }

    const hasAccessToAll = userGroups.includes("all");

    const resourcesResponse = await axios.get(
      `https://${IP}:8006/api2/json/cluster/resources`,
      {
        headers: {
          Cookie: `PVEAuthCookie=${ticket}`,
          CSRFPreventionToken: csrfToken,
        },
        httpsAgent,
      }
    );

    const allResources = resourcesResponse.data.data;

    const vms = [];
    const vmsToProcess = hasAccessToAll
      ? allResources.filter(vm => vm.type === "qemu")
      : allResources.filter(vm => {
          if (vm.type !== "qemu" || !vm.tags) return false;
          const vmTags = vm.tags.split(';').map(tag => tag.trim());
          return vmTags.some(tag => userGroups.includes(tag));
        });

    for (const vm of vmsToProcess) {
      let diskNames = [];

      try {
        const configResponse = await axios.get(
          `https://${IP}:8006/api2/json/nodes/${vm.node}/qemu/${vm.vmid}/config`,
          {
            headers: {
              Cookie: `PVEAuthCookie=${ticket}`,
              CSRFPreventionToken: csrfToken,
            },
            httpsAgent,
          }
        );

        diskNames = Object.entries(configResponse.data.data)
          .filter(([key]) => key.startsWith("scsi") || key.startsWith("virtio") || key.startsWith("ide"))
          .map(([_, value]) => {
            const parts = value.split(':');
            return parts[1]; // ex: base-101-disk-0
          });
      } catch (err) {
        console.warn(`Impossible de récupérer les disques de la VM ${vm.vmid} :`, err.message);
      }

      vms.push({
        vmid: vm.vmid,
        name: vm.name,
        node: vm.node,
        maxcpu: vm.maxcpu,
        maxmem: (vm.maxmem / 1024 / 1024 / 1024).toFixed(2),
        maxdisk: (vm.maxdisk / 1024 / 1024 / 1024).toFixed(2),
        status: vm.status,
        tags: vm.tags,
        diskNames,
        cpuUsage: vm.cpu || 0,
        memUsed: vm.mem || 0,
        memMax: vm.maxmem || 0,
      });
    }

    res.json(vms);
  } catch (error) {
    console.error("Erreur lors de la récupération des VMs :", error.response?.data || error.message);
    res.status(500).send("Erreur lors de la récupération des données des VMs");
  }
});

app.post('/vms/:vmid/start', async (req, res) => {
  const { vmid } = req.params;
  const { username, password, node } = req.query;

  if (!username || !password) {
    return res.status(400).send("Erreur : Identifiant ou mot de passe manquant.");
  }
  if (!node) {
    return res.status(400).send("Erreur : paramètre 'node' manquant.");
  }

  try {
    const authResponse = await axios.post(
      `https://${IP}:8006/api2/json/access/ticket`,
      new URLSearchParams({
        username,
        password,
      }),
      { httpsAgent }
    );

    const { ticket, CSRFPreventionToken } = authResponse.data.data;

    await axios.post(
      `https://${IP}:8006/api2/json/nodes/${node}/qemu/${vmid}/status/start`,
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

app.post('/vms/:vmid/stop', async (req, res) => {
  const { vmid } = req.params;
  const { username, password, node } = req.query;

  if (!username || !password) {
    return res.status(400).send("Erreur : Identifiant ou mot de passe manquant.");
  }
  if (!node) {
    return res.status(400).send("Erreur : paramètre 'node' manquant.");
  }

  try {
    const authResponse = await axios.post(
      `https://${IP}:8006/api2/json/access/ticket`,
      new URLSearchParams({
        username,
        password,
      }),
      { httpsAgent }
    );

    const { ticket, CSRFPreventionToken } = authResponse.data.data;

    await axios.post(
      `https://${IP}:8006/api2/json/nodes/${node}/qemu/${vmid}/status/stop`,
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

app.get('/vms/:vmid/config', async (req, res) => {
  const { vmid } = req.params;
  const { username, password, node } = req.query;
  if (!username || !password || !node) {
    return res.status(400).send('Paramètres manquants.');
  }
  try {
    const authResponse = await axios.post(
      `https://${IP}:8006/api2/json/access/ticket`,
      new URLSearchParams({ username, password }),
      { httpsAgent }
    );
    const { ticket, CSRFPreventionToken } = authResponse.data.data;
    const configResponse = await axios.get(
      `https://${IP}:8006/api2/json/nodes/${node}/qemu/${vmid}/config`,
      {
        headers: { Cookie: `PVEAuthCookie=${ticket}`, CSRFPreventionToken },
        httpsAgent,
      }
    );
    res.json(configResponse.data.data);
  } catch (error) {
    console.error(`Erreur config VM ${vmid}:`, error.response?.data || error.message);
    res.status(500).send(`Erreur lors de la récupération de la config VM ${vmid}.`);
  }
});

app.put('/vms/:vmid/config', async (req, res) => {
  const { vmid } = req.params;
  const { username, password, node } = req.query;
  const updates = req.body;
  if (!username || !password || !node) {
    return res.status(400).send('Paramètres manquants.');
  }
  try {
    const authResponse = await axios.post(
      `https://${IP}:8006/api2/json/access/ticket`,
      new URLSearchParams({ username, password }),
      { httpsAgent }
    );
    const { ticket, CSRFPreventionToken } = authResponse.data.data;
    const params = new URLSearchParams();
    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, String(value));
      }
    });
    await axios.put(
      `https://${IP}:8006/api2/json/nodes/${node}/qemu/${vmid}/config`,
      params,
      {
        headers: { Cookie: `PVEAuthCookie=${ticket}`, CSRFPreventionToken },
        httpsAgent,
      }
    );
    res.status(200).send('Configuration mise à jour avec succès.');
  } catch (error) {
    console.error(`Erreur MAJ config VM ${vmid}:`, error.response?.data || error.message);
    res.status(500).send(`Erreur lors de la mise à jour de la config VM ${vmid}.`);
  }
});

app.get('/all-vms', async (req, res) => {
  const { username, password } = req.query;

  if (!username || !password) {
      return res.status(400).json({ message: 'Identifiant ou mot de passe manquant.' });
  }

  try {
      const ticketResponse = await axios.post(
          `https://${IP}:8006/api2/json/access/ticket`,
          new URLSearchParams({ username, password }),
          { httpsAgent }
      );

      const ticket = ticketResponse.data.data.ticket;

      const resourcesResponse = await axios.get(
          `https://${IP}:8006/api2/json/cluster/resources`,
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
              node: vm.node,
              maxcpu: vm.maxcpu,
              maxmem: (vm.maxmem / 1024 / 1024 / 1024).toFixed(2),
              maxdisk: (vm.maxdisk / 1024 / 1024 / 1024).toFixed(2),
              status: vm.status,
              tags: vm.tags,
          }));

      res.json(vms);
  } catch (error) {
      console.error('Erreur lors de la récupération des VMs :', error.response?.data || error.message);
      res.status(500).send('Erreur lors de la récupération des données des VMs');
  }
});

app.post('/clone-vm', async (req, res) => {
  const { sourceVmid, newVmid, newVmName, node } = req.body;
  const { username, password } = req.query;

  if (!username || !password || !sourceVmid || !newVmid || !newVmName || !node) {
    return res.status(400).json({ message: 'Tous les champs sont requis (dont node).' });
  }

  try {
    const authResponse = await axios.post(
      `https://${IP}:8006/api2/json/access/ticket`,
      new URLSearchParams({ username, password }),
      { httpsAgent }
    );

    const { ticket, CSRFPreventionToken } = authResponse.data.data;

    const cloneResponse = await axios.post(
      `https://${IP}:8006/api2/json/nodes/${node}/qemu/${sourceVmid}/clone`,
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

    const updateTagsResponse = await axios.put(
      `https://${IP}:8006/api2/json/nodes/${node}/qemu/${newVmid}/config`,
      new URLSearchParams({
        tags: 'sae',
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

app.get('/iso-list', async (req, res) => {
  const { username, password, node } = req.query;

  if (!username || !password) {
      return res.status(400).json({ message: 'Identifiant ou mot de passe manquant.' });
  }
  if (!node) {
      return res.status(400).json({ message: "Paramètre 'node' manquant." });
  }

  try {
      const ticketResponse = await axios.post(
          `https://${IP}:8006/api2/json/access/ticket`,
          new URLSearchParams({ username, password }),
          { httpsAgent }
      );

      const ticket = ticketResponse.data.data.ticket;

      const isoUrl = `https://${IP}:8006/api2/json/nodes/${node}/storage/local/content`;

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

app.get('/storages', async (req, res) => {
  const { username, password, node } = req.query;
  if (!username || !password) {
    return res.status(400).json({ message: 'Identifiant ou mot de passe manquant.' });
  }
  if (!node) {
    return res.status(400).json({ message: "Paramètre 'node' manquant." });
  }

  try {
    // Auth
    const ticketResp = await axios.post(
      `https://${IP}:8006/api2/json/access/ticket`,
      new URLSearchParams({ username, password }),
      { httpsAgent }
    );
    const ticket = ticketResp.data.data.ticket;

    // Liste des storages du node
    const storagesResp = await axios.get(
      `https://${IP}:8006/api2/json/nodes/${node}/storage`,
      { headers: { Cookie: `PVEAuthCookie=${ticket}` }, httpsAgent }
    );

    // Pour chacun, on récupère son statut (total/avail)
    const enriched = await Promise.all(
      storagesResp.data.data.map(async (st) => {
        try {
          const statusResp = await axios.get(
            `https://${IP}:8006/api2/json/nodes/${node}/storage/${encodeURIComponent(st.storage)}/status`,
            { headers: { Cookie: `PVEAuthCookie=${ticket}` }, httpsAgent }
          );
          const s = statusResp.data.data;
          // Proxmox renvoie des bytes → convertissons en GiB
          const toGiB = (b) => (b / 1024 / 1024 / 1024);
          return {
            storage: st.storage,       // ex: "local-lvm"
            type: st.type,             // ex: "lvmthin", "dir", "zfspool"...
            content: st.content,       // ex: "images,iso,backup"
            shared: !!st.shared,
            totalGiB: +toGiB(s.total).toFixed(2),
            usedGiB: +toGiB(s.used).toFixed(2),
            availGiB: +toGiB(s.avail).toFixed(2),
            active: s.active
          };
        } catch {
          // si erreur statut, on renvoie quand même l’entrée basique
          return {
            storage: st.storage,
            type: st.type,
            content: st.content,
            shared: !!st.shared,
            totalGiB: null,
            usedGiB: null,
            availGiB: null,
            active: null
          };
        }
      })
    );

    // On ne garde que les storages capables d’héberger des disques VM (content inclut "images")
    const diskCapable = enriched.filter(s => (s.content || '').includes('images'));
    res.json(diskCapable);
  } catch (error) {
    console.error('Erreur storages :', error.response?.data || error.message);
    res.status(500).json({ message: 'Erreur lors de la récupération des storages.' });
  }
});

app.post('/new-vm', async (req, res) => {
  const { username, password, vmid, name, diskSize, isoImage, sockets, cores, memory, tags, storage, node } = req.body;

  if (!username || !password) {
      return res.status(400).json({ message: 'Identifiant ou mot de passe manquant.' });
  }

  try {
      const authResponse = await axios.post(
          `https://${IP}:8006/api2/json/access/ticket`,
          new URLSearchParams({ username, password }),
          { httpsAgent }
      );

      const { ticket, CSRFPreventionToken } = authResponse.data.data;

      if (!node) {
        return res.status(400).json({ message: "Paramètre 'node' manquant." });
      }
      const createVmUrl = `https://${IP}:8006/api2/json/nodes/${node}/qemu`;

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
      if (diskSize) {
        const targetStorage = storage || 'local-lvm'; // fallback si rien choisi
        params.append('scsi0', `${targetStorage}:${diskSize}`);
      }
      if (tags && Array.isArray(tags)) {
        params.append('tags', tags.join(';'));
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

app.delete('/vms/:vmid', async (req, res) => {
  const { username, password, node } = req.query;
  const { vmid } = req.params;

  if (!username || !password) {
    return res.status(400).send("Erreur : Identifiant ou mot de passe manquant.");
  }
  if (!node) {
    return res.status(400).send("Erreur : paramètre 'node' manquant.");
  }

  try {
    const ticketResponse = await axios.post(
      `https://${IP}:8006/api2/json/access/ticket`,
      new URLSearchParams({
        username,
        password,
      }),
      { httpsAgent }
    );

    const { ticket, CSRFPreventionToken } = ticketResponse.data.data;

    const deleteVmResponse = await axios.delete(
      `https://${IP}:8006/api2/json/nodes/${node}/qemu/${vmid}`,
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

app.post('/logout', (req, res) => {
  res.clearCookie('PVEAuthCookie', { path: '/', domain: IP, secure: true });
  res.clearCookie('userCredentials', { path: '/', domain: IP, secure: true });
  res.redirect('/');
});

https.createServer(httpsOptions, app).listen(PORT, () => {
  console.log(`Server running on https://${IP}:${PORT}`);
});
