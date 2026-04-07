# VMM — Virtual Machine Manager

Interface web Node.js pour gérer des machines virtuelles Proxmox VE.  
Supporte plusieurs nodes, gestion des VMs (démarrage, arrêt, clone, création, suppression), accès console VNC et monitoring CPU/RAM en temps réel.

---

## Prérequis

- Proxmox VE accessible en réseau
- Debian/Proxmox comme OS hôte pour le serveur Node.js
- Git

> Node.js, npm, OpenSSL et pm2 sont installés automatiquement par `install.sh` si absents.

---

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/R3coNYT/VMM/main/install.sh -o install.sh
chmod +x install.sh && sudo ./install.sh
```

Le script d'installation :
1. Installe automatiquement les dépendances système (`git`, `nodejs`, `npm`, `openssl`) si absentes
2. Installe **pm2** globalement via npm
3. Clone le projet dans `/opt/vmm`
4. Liste les interfaces réseau disponibles et demande laquelle utiliser
5. Génère le fichier de configuration `/opt/vmm/vmm.conf` avec l'IP choisie
6. Génère les certificats SSL auto-signés dans `/opt/vmm` (`cert.pem` / `key.pem`, RSA 4096, 365 jours)
7. Lance `npm install` pour les dépendances applicatives
8. Démarre l'application via pm2 sous le nom **VMM**
9. Configure le démarrage automatique au boot (`pm2 startup`)

---

## Configuration — `vmm.conf`

Créé automatiquement par `install.sh`. Ne pas versionner (exclus via `.gitignore`).

```ini
# Adresse IP de la machine hôte Proxmox
IP=192.168.1.x

# Port HTTPS de l'interface web
PORT=4000
```

---

## Mise à jour

```bash
sudo /opt/vmm/update.sh
```

Le script de mise à jour :
- Vérifie s'il y a des commits distants disponibles
- Affiche la liste des nouveaux commits avant d'appliquer
- Avertit si des fichiers locaux sont modifiés (hors `vmm.conf` et `*.pem`)
- Lance `npm install` si `package.json` a changé
- Redémarre automatiquement VMM via pm2

---

## Gestion de l'application (pm2)

```bash
pm2 status              # état de VMM
pm2 logs VMM            # logs en direct
pm2 restart VMM         # redémarrer
pm2 stop VMM            # arrêter
```

---

## Fonctionnalités

| Page | Description |
|---|---|
| `/dashboard` | Tableau de bord — liste des VMs par node avec monitoring en temps réel |
| `/clone-vm` | Cloner une VM depuis un template |
| `/new-vm` | Créer une nouvelle VM |
| `/del-vm` | Supprimer une VM |

### Tableau de bord
- Cartes par VM avec statut (démarrée / arrêtée), VMID, CPU, RAM, Disk
- **Barres d'utilisation temps réel** (CPU et RAM en %) sur chaque VM active — rafraîchissement automatique toutes les 5 secondes sans rechargement de page
- Boutons d'action : démarrer, arrêter, ouvrir la console VNC (noVNC)

### Multi-nodes
Une barre de sélection de nodes est présente sur chaque page.  
Le node sélectionné est mémorisé dans `sessionStorage` et partagé entre les pages.  
Les VMs, ISOs, storages et actions (start/stop/delete/clone/create) ciblent dynamiquement le node actif.

### Thème clair / sombre
Bascule persistante via `localStorage` — pas de flash au chargement.  
Le bouton de bascule est injecté automatiquement dans la navbar sur toutes les pages authentifiées.

### Accès
- **HTTPS** : `https://<IP>:4000`
- Redirection automatique HTTP → HTTPS sur le port 80

---

## Structure

```
VMM/          ← dépôt git (sources)
/opt/vmm/                 ← répertoire d'installation
├── app.js              # Serveur Express — API backend
├── vmm.conf            # Configuration locale (ignoré par git)
├── cert.pem / key.pem  # Certificats SSL (ignorés par git)
├── install.sh          # Script d'installation
├── update.sh           # Script de mise à jour
├── package.json
└── public/
    ├── style.css       # Design system commun (thème glassmorphic dark/light)
    ├── index.html      # Dashboard + monitoring CPU/RAM
    ├── clone_vm.html
    ├── new_vm.html
    ├── del_vm.html
    ├── login.html
    └── logout.js       # Déconnexion + injection bascule thème
```

---

## Sécurité

- Authentification déléguée à l'API Proxmox (tickets PVE)
- Les credentials sont stockés en cookie `HttpOnly` + `Secure` + `SameSite=Strict`
- Les certificats SSL sont auto-signés — ajoutez une exception dans votre navigateur ou remplacez par un certificat signé
- `vmm.conf` et `*.pem` sont exclus du dépôt git
