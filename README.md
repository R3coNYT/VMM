# VMM — Virtual Machine Manager

Node.js web interface for managing Proxmox VE virtual machines.  
Supports multiple nodes, VM management (start, stop, clone, create, delete), VNC console access, and real-time CPU/RAM monitoring.

---

## Requirements

- Proxmox VE
- Proxmox as the host OS for the Node.js server
- Git

> Node.js, npm, OpenSSL and pm2 are installed automatically by `install.sh` if missing.

---

## Installation

### You have to install VMM on your Proxmox server and on the same network interface (if your proxmox is configured on the "eth0" interface VMM needs to be on the same interface)

```bash
curl -fsSL https://raw.githubusercontent.com/R3coNYT/VMM/main/install.sh -o install.sh
chmod +x install.sh && sudo ./install.sh
```

The install script:

1. Automatically installs system dependencies (`git`, `nodejs`, `npm`, `openssl`) if missing
2. Installs **pm2** globally via npm
3. Clones the project into `/opt/vmm`
4. Lists available network interfaces and asks which one to use
5. Generates `/opt/vmm/vmm.conf` with the chosen IP
6. Generates self-signed SSL certificates in `/opt/vmm` (`cert.pem` / `key.pem`, RSA 4096, 365 days)
7. Runs `npm install` for application dependencies
8. Starts the application via pm2 under the name **VMM**
9. Configures auto-start at boot (`pm2 startup`)

---

## Configuration — `vmm.conf`

Created automatically by `install.sh`. Do not commit this file (excluded via `.gitignore`).

```ini
# IP address of the Proxmox host machine
IP=192.168.1.x

# HTTPS port for the web interface
PORT=4000
```

---

## Update

```bash
sudo /opt/vmm/update.sh
```

The update script:

- Checks whether remote commits are available
- Displays the list of new commits before applying
- Warns if local files have been modified (excluding `vmm.conf` and `*.pem`)
- Runs `npm install` if `package.json` has changed
- Automatically restarts VMM via pm2

---

## Application management (pm2)

```bash
pm2 status              # VMM status
pm2 logs VMM            # live logs
pm2 restart VMM         # restart
pm2 stop VMM            # stop
```

---

## Features

| Page | Description |
|------|-------------|

| `/dashboard` | Dashboard — VM list per node with real-time monitoring |
| `/clone-vm` | Clone a VM from a template |
| `/new-vm` | Create a new VM |
| `/del-vm` | Delete a VM |

### Dashboard

- Per-VM cards showing status (running / stopped), VMID, CPU, RAM, Disk
- **Real-time usage bars** (CPU and RAM in %) on each running VM — automatic refresh every 5 seconds without page reload
- Action buttons: start, stop, open VNC console (noVNC)

### Multi-node

A node selection bar is available on every page.  
The selected node is stored in `sessionStorage` and shared across pages.  
VMs, ISOs, storages and all actions (start/stop/delete/clone/create) dynamically target the active node.

### Light / Dark theme

Persistent toggle via `localStorage` — no flash on load.  
The toggle button is automatically injected into the navbar on all authenticated pages.

### Access

- **HTTPS**: `https://<IP>:4000`
- Automatic HTTP → HTTPS redirect on port 80

---

## Structure

``` structure
VMM/                      ← git repository (sources)
/opt/vmm/                 ← installation directory
├── app.js              # Express server — backend API
├── vmm.conf            # Local config (git-ignored)
├── cert.pem / key.pem  # SSL certificates (git-ignored)
├── install.sh          # Installation script
├── update.sh           # Update script
├── package.json
└── public/
    ├── style.css       # Shared design system (glassmorphic dark/light theme)
    ├── index.html      # Dashboard + CPU/RAM monitoring
    ├── clone_vm.html
    ├── new_vm.html
    ├── del_vm.html
    ├── login.html
    └── logout.js       # Logout + theme toggle injection
```

---

## Security

- Authentication delegated to the Proxmox API (PVE tickets)
- Credentials stored in an `HttpOnly` + `Secure` + `SameSite=Strict` cookie
- SSL certificates are self-signed — add a browser exception or replace with a signed certificate
- `vmm.conf` and `*.pem` are excluded from the git repository
