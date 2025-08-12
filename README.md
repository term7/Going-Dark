# Going Dark: USB Privacy Gadget based on a Raspberry Pi
*A portable RaspberryPi USB Ethernet Gadget that safeguards your Privacy*

Are you aware of the growing concerns among European law enforcement about people [going dark](https://home-affairs.ec.europa.eu/networks/high-level-group-hlg-access-data-effective-law-enforcement_en)? The so-called High Level Group (HLG) is actively working to undermine end-to-end encryption, pushing for backdoor access to encrypted messaging apps, cloud storage, and email services. EDRi has dissected the critical flaws in this approach: [https://edri.org/?s=going+dark](https://edri.org/?s=going+dark)

If you haven’t gone dark yet, now is the time!

This repository is both a guide and a step-by-step tutorial for configuring a Raspberry Pi 4 as a USB Ethernet Gadget. It forces your computer to route all internet traffic through either a WireGuard VPN or a Tor Transparent Proxy while filtering outbound traffic, blocking ads and trackers, and spoofing its device identity for enhanced privacy.

- [01 INTRODUCTION](#01-introduction)
- [02 FEATURES](#02-features)
- [03 PREREQUISITES](#03-prerequisites)
- [04 USER ACCESS CONTROL](#04-user-access-control)
- [05 HARDEN SSH CONFIGURATION](#05-harden-ssh-configuration)
- [06 UNATTENDED UPGRADES](#06-unattended-upgrades)
- [07 DISABLE IPv6](#07-disable-ipv6)
- [08 RANDOM MAC ADDRESS](#08-random-mac-address)
- [09 RANDOM HOSTNAME](#09-random-hostname)
- [10 SETUP USBC ETHERNET GADGET](#10-setup-usbc-ethernet-gadget)
- [11 SETUP WIRELESS HOTSPOT](#11-setup-wireless-hotspot)
- [12 SETUP NTP](#12-setup-ntp)
- [13 PREPARE DNSMASQ](#13-prepare-dnsmasq)
- [14 PREPARE UNBOUND](#14-prepare-unbound)
- [15 PREPARE ADGUARDHOME](#15-prepare-adguardhome)
- [16 SSL CERTIFICATE](#16-ssl-certificate)
- [17 SETUP NGINX REVERSE PROXY](#17-setup-nginx-reverse-proxy)
- [18 FIREWALL](#18-firewall)
- [19 CONFIGURE ADGUARDHOME](#19-configure-adguardhome)
- [20 DNS BLOCKLISTS](#20-dns-blocklists)
- [21 WIREGUARD VPN](#21-wireguard-vpn)
- [22 TOR TRANSPARENT PROXY](#22-tor-transparent-proxy)
- [23 LOCAL WEB CONTROL INTERFACE](#23-local-web-control-interface)

* * *

## 01 INTRODUCTION

We first came up with the idea for this Raspberry Pi Ethernet Gadget five years ago, when Apple publicly released macOS Big Sur in the fall of 2020. During the transition, we noticed that our installation of Little Snitch—a host-based firewall—had partially stopped working. More specifically, all Apple processes were no longer being filtered. Strange.

As we investigated the issue online, we came across a blog post by security researcher Jeffrey Paul, titled [Your Computer Isn't Yours](https://sneak.berlin/20201112/your-computer-isnt-yours/#updates). His findings shed light on the problem, and we highly recommend reading this article before setting up your own Raspberry Pi Privacy Gadget.

In short: modern versions of MacOS have a built-in capability to bypass internal firewalls and VPNs. Additionally, every Apple computer continuously connects to both Apple’s servers and third parties (such as Fastly) to transmit hashes of apps being used—every time they are launched:<br>
This is meant to be a security feature to detect malicious software. It exists to prevent malicious or blacklisted apps from running if an online certificate check fails. While this may be true, it also means Apple can always determine when you are online, where you are, how long you use specific software like VMWare Fusion), or when you use the Tor Browser instead of Safari.<br>
Over time, this data collection builds a highly detailed profile of your digital habits, physical movements, and activity patterns. Worse, this information can potentially be correlated with other big data sources from corporations like Google, Microsoft, and Facebook. As Jeffrey Paul aptly points out:

*Since October of 2012, Apple is a partner in the US military intelligence community’s PRISM spying program, which grants the US federal police and military unfettered access to this data without a warrant, any time they ask for it.*

We see this as a deeply concerning development: yet another step toward surveillance capitalism that undermines the privacy of all Apple users.

To be fair, Apple has faced significant criticism for these practices. As a result, some of these intrusions, such as the ContentFilterExclusionList, which allowed native Apple apps to bypass local firewalls and VPNs — have since been revoked: [A Wall without a Hole](https://blog.obdev.at/a-wall-without-a-hole/).

According to Apple, [privacy](https://www.apple.com/privacy/) is a fundamental human right:

*Privacy is a fundamental human right. At Apple, it’s also one of our core values. Your devices are important to so many parts of your life. What you share from those experiences, and who you share it with, should be up to you. We design Apple products to protect your privacy and give you control over your information. It’s not always easy. But that’s the kind of innovation we believe in.*

Yet, claiming to deeply care about user privacy while officially supporting the [CLOUD Act](https://en.wikipedia.org/wiki/CLOUD_Act) and participating in programs like [PRISM](https://en.wikipedia.org/wiki/PRISM_(surveillance_program)#Extent_of_the_program), exposes a double-standard that should not be tolerated.

Who’s to say something like the ContentFilterExclusionList won’t quietly return in a future update?
We believe Apple cannot be trusted with our data. That’s why we built the Raspberry Pi Ethernet Gadget—a portable external network filtering device designed to make data harvesting as difficult as possible.

As Jeffrey Paul rightly points out: Your computer is not yours.<br>
But it should be!

* * *

On February 21, 2025, Apple disabled its Advanced Data Protection (ADP) feature for UK customers, likely in response to a secretive UK government directive, known as a Technical Capability Notice, issued under the Investigatory Powers Act of 2016. ​Already on 7 February 2025, the [Washington Post](https://www.washingtonpost.com/technology/2025/02/07/apple-encryption-backdoor-uk/) reported on a leaked document that anticipated Apple's move. In compliance, Apple ceased offering ADP to new UK users and announced plans to disable it for existing users. This move likely is an attempt to protect Apple customers worldwide, since British surveillance authorities demand worldwide access to encrypted Apple backups.

This kind of surveillance order, even [Google](https://www.heise.de/en/news/Even-Google-cannot-deny-the-British-surveillance-order-10318847.html) can neither confirm nor deny, indicating that it received a similar Technical Capability Notice.

*"The UK Government has given themselves the power to serve companies anywhere in the world notices that order them to undermine the security of their users, products, or services in secret. The company can’t tell anyone, they can’t even publicly say they’ve received one. They can’t say if they disagree, they can’t let users know they’ve been affected, and they can’t question the power in open court because the secret order is, well, secret. The notice affects millions of people, who aren’t allowed to find out it exists.”*

[Privacy International](https://privacyinternational.org/news-analysis/5530/apple-and-long-secret-arm-uk-government)

Apple has since filed an [appeal](https://www.ft.com/content/3d8fe709-f17a-44a6-97ae-f1bbe6d0dccd?utm_source=chatgpt.com) with the Investigatory Powers Tribunal, challenging the legality of the government's order. The outcome of this appeal could have significant implications for user privacy and the extent of government surveillance powers in the UK. 

However, this effectively means that all data stored in the cloud by UK customers is no longer end-to-end encrypted. Instead, Apple retains the encryption keys, meaning the company must hand them over upon receiving a warrant.

This is not just a policy change: it is an outright assault on encryption and online privacy as a whole.

#### RECOMMENDED READING:

Privacy International:<br>
[https://privacyinternational.org/news-analysis/5530/apple-and-long-secret-arm-uk-government](https://privacyinternational.org/news-analysis/5530/apple-and-long-secret-arm-uk-government)
[https://privacyinternational.org/explainer/5531/pis-opinion-how-uk-government-making-security-harder-everyone](https://privacyinternational.org/explainer/5531/pis-opinion-how-uk-government-making-security-harder-everyone)

The Washington Post:<br>
[https://www.washingtonpost.com/technology/2025/02/07/apple-encryption-backdoor-uk/](https://www.washingtonpost.com/technology/2025/02/07/apple-encryption-backdoor-uk/)

Heise Online:<br>
[https://www.heise.de/en/news/Even-Google-cannot-deny-the-British-surveillance-order-10318847.html](https://www.heise.de/en/news/Even-Google-cannot-deny-the-British-surveillance-order-10318847.html)

Jeffrey Paul:<br/>
[https://sneak.berlin/20201112/your-computer-isnt-yours/#updates](https://sneak.berlin/20201112/your-computer-isnt-yours/#updates)

Apple:<br/>
[https://www.apple.com/privacy/](https://www.apple.com/privacy/)<br/>
[https://www.apple.com/legal/transparency/](https://www.apple.com/legal/transparency/)

PRISM & CLOUD Act:<br/>
[https://en.wikipedia.org/wiki/PRISM_(surveillance_program)](https://en.wikipedia.org/wiki/PRISM_(surveillance_program))<br/>
[https://www.reuters.com/article/us-apple-fbi-icloud-exclusive/exclusive-apple-dropped-plan-for-encrypting-backups-after-fbi-complained-sources-idUSKBN1ZK1CT](https://www.reuters.com/article/us-apple-fbi-icloud-exclusive/exclusive-apple-dropped-plan-for-encrypting-backups-after-fbi-complained-sources-idUSKBN1ZK1CT)<br>
[https://en.wikipedia.org/wiki/CLOUD_Act](https://en.wikipedia.org/wiki/CLOUD_Act)

Objective Development:<br/>
[https://blog.obdev.at/a-wall-without-a-hole/](https://blog.obdev.at/a-wall-without-a-hole/)<br/>
[https://blog.obdev.at/a-hole-in-the-wall/](https://blog.obdev.at/a-hole-in-the-wall/)
<br/><br/>

* * *

## 02 FEATURES

**GOING DARK: This Raspberry Pi Privacy Gadget acts as a portable router, giving you complete control over all network traffic—including native Apple processes. By following our guide, your Mac’s Wi-Fi will be completely disabled. Instead, it will connect to the Raspberry Pi via USB-C, while the Raspberry Pi manages the internet connection.**

**1) MODE 1: Network-Wide Filtering with AdGuardHome**

 In this mode, your Ethernet Gadget filters all traffic through AdGuardHome, a self-hosted DNS sinkhole designed to block ads, trackers, and malicious domains across your entire network. To further enhance privacy, we configure Unbound as the upstream DNS resolver, ensuring that your queries are resolved privately without relying on third-party DNS providers. Additionally, we install extensive blocklists, including our own Ultimate Apple Blocklist, which blocks all domains owned by Apple. WARNING: Enabling this blocklist will break Apple services and software. Proceed with caution.

**2) MODE 2: Encrypted VPN Tunnel with WireGuard (Optional Setup)**

In this mode, you can use your Raspberry Pi as a WireGuard client, allowing it to establish a secure, encrypted VPN tunnel. You can connect to your home router (RECOMMENDED - if WireGuard is installed and configured) or to any other WireGuard server of your choice (NOT RECOMMENDED). Even with the VPN enabled, AdGuardHome will continue filtering ads and trackers before forwarding DNS requests through the encrypted tunnel. This ensures both privacy and security while maintaining full network-wide ad blocking.

**3) MODE 3: Tor Transparent Proxy**

In this mode, all your internet traffic is routed through a Tor Transparent Proxy, providing anonymity by passing your connections through the Tor network. Even in this setup, AdGuardHome continues filtering ads and trackers before traffic enters the Tor network, enhancing privacy and reducing unnecessary connections. Important Note: This is not necessarily the recommended approach for anonymity. If your goal is to browse the web privately, it is strongly advised to use the Tor Browser instead, as it provides additional protections that a transparent proxy cannot.

**4) Wireless Hotspot Support**

In addition to connecting your Mac via USB, your Raspberry Pi Privacy Gadget can also function as a wireless hotspot, allowing other devices—such as smartphones—to connect and use MODE 1, MODE 2, or MODE 3 for enhanced privacy and security. Important Note: If you want to connect the Raspberry Pi to a Wi-Fi network while running a hotspot, you’ll need an additional Wi-Fi adapter.<br>
For this tutorial, we use the [ALFA AWUS036ACM](https://www.alfa.com.tw/products/awus036acm_1?_pos=1&_ss=r&variant=40320133464136), which works out of the box and provides stable dual-band Wi-Fi connectivity.

**5) Hardened Security**

To ensure maximum security, we implement multiple layers of protection:

- Firewall Protection with nftables – We configure nftables as a robust firewall, dynamically managed via NetworkManager’s dispatcher to seamlessly adapt between MODE 1, MODE 2, and MODE 3, ensuring secure and reliable operation.
- Hardened SSH Configuration – Secure access is enforced through a carefully hardened SSH setup, reducing attack vectors and improving overall system integrity.
- User Access Control – We establish separate admin and standard user accounts, following best security practices to limit privileges and reduce risks.
- Automated Security Updates – Unattended upgrades ensure that critical software remains up to date, minimizing vulnerabilities and enhancing system resilience.

**6) Randomized Device Identity**

Whenever you connect to a public Wi-Fi network, only your Raspberry Pi Ethernet Gadget’s identity will be logged — not your Mac’s. This prevents network operators from tracking your actual device.

To further enhance privacy:

- MAC Address Randomization – The Ethernet Gadget generates a new, random MAC address on every reboot, making device tracking significantly harder.
- Random Hostname Generation – On each reboot, the Ethernet Gadget selects a random hostname from a predefined dictionary, preventing easy identification.

These measures ensure that your digital footprint remains as anonymous as possible when connecting to public networks.

**7) Privacy Respecting NTP Server**

To maintain accurate system time without compromising privacy, we configure the Raspberry Pi Ethernet Gadget to use privacy-respecting NTP servers from [ntppool.org](https://www.ntppool.org/en/use.html).

Key Features:
- Privacy-Focused Time Synchronization – Ensures system time is updated via trusted NTP servers while avoiding centralized, privacy-invasive time sources.
- Extended Offline Support – Configured to handle longer periods of downtime, allowing the device to reconnect to the internet even after being switched off for an extended period.
- Local Time Server for Connected Devices – Clients using the Raspberry Pi Ethernet Gadget can sync their system time directly from the Pi’s built-in NTP server.
- Optional: For even more reliability, we recommend installing a hardware clock (RTC module) to prevent synchronization issues.

**8) Local Web Interface**

To simplify management, we set up a local web interface that allows you to:

- Easily switch between MODE 1, MODE 2, and MODE 3
- Connect the Raspberry Pi to external Wi-Fi networks without using terminal commands
- Enable or disable the Hotspot with a single click

This intuitive interface provides seamless control over your Raspberry Pi Ethernet Gadget, making it easy to configure settings directly from your browser.

* * *

## 03 PREREQUISITES

#### HARDWARE:

For this setup, we use a Raspberry Pi 4B (8GB). To ensure stable performance, it's essential to use a high-quality USB-C cable that supports fast data transfer. Additionally, we use the [ALFA AWUS036ACM](https://www.alfa.com.tw/products/awus036acm_1?_pos=1&_ss=r&variant=40320133464136). If you choose a different external WiFi adapter, ensure it is compatible with Raspberry Pi OS and update the interface name in this tutorial accordingly! A reliable microSD card is crucial for smooth operation. Avoid cheap, low-quality brands. We highly recommend SanDisk A1-rated cards, as they offer excellent performance. High-endurance microSD cards are also a great option—they are fast enough and provide outstanding durability based on our experience. A 32GB card is more than sufficient for this setup.

#### OPTIONAL:

An active cooling system to prevent overheating, especially during hot summer days. We recommend the [EP-0163 Ice Tower](https://wiki.52pi.com/index.php?title=EP-0163) for efficient cooling. A Real-Time Clock (RTC) module, such as the [RV3028](https://shop.pimoroni.com/products/rv3028-real-time-clock-rtc-breakout?variant=27926940549203), is useful for maintaining accurate time synchronization, especially when the Raspberry Pi stays switched off or offline for a prolonged period of time. It fits neatly alongside the EP-0163 Ice Tower.

#### INSTALL RASPBERRY Pi OS (Headless Setup)

**1. Download and Install the Raspberry Pi Imager**

- Get the official [Raspberry Pi Imager](https://downloads.raspberrypi.org/imager/imager_latest.dmg)  and install Raspberry Pi OS Lite (64-bit), based on Debian Bookworm.

**2. Enable SSH and Configure Network**

- We recommend a headless setup, meaning you won't need an external monitor, mouse, or keyboard. Instead, you can complete the entire setup from your computer.
- The advantage of a headless setup is that it skips the Welcome Wizard and allows you to remotely access the Raspberry Pi immediately after the first boot.
- To achieve this, make sure to set up the username, password, and network configuration through the OS customization settings in Raspberry Pi Imager. For this tutorial we use **Username: term7** as username. If you choose a different username, make sure to replace it accordingly whenever it appears in this tutorial.
- If you're unfamiliar with setting up a Raspberry Pi for the first time, follow our detailed headless installation guide: [Headless Raspberry Pi OS Setup Guide](https://term7.info/intro-raspberry-pi/#PI-IMAGER)

**3. Update Your System**

- After installation, update your Raspberry Pi OS as described in the tutorial linked above. There’s no need to follow additional steps from that guide.<br>

**4. Additional Tweaks**

However, if you're interested, you might want to check out: [Z-Ram Tweaks](https://term7.info/intro-raspberry-pi/#Z-RAM): These optimizations can improve system performance, especially on low-memory setups.<br>
[MOTD Tweaks](https://term7.info/intro-raspberry-pi/#MOTD): Customizing the Message of the Day (MOTD) can enhance your login experience with useful system info. Both tweaks are optional but can be beneficial.<br>
Skip the sections on user access management, SSH hardening, and firewall setup. These will be fully covered in this tutorial!

#### EXPAND FILE SYSTEM AND ENABLE PREDICTABLE INTERFACE NAMES

To configure your Raspberry Pi, open the Raspberry Pi Configuration Tool by running:
```
sudo raspi-config
```

**1. Expand Filesystem**

- Navigate to 6. Advanced Options → A1 Expand Filesystem.
- This ensures that the full storage capacity of your SD card is available.

**2. Enable Predictable Network Interface Names**

- Go to 6. Advanced Options → A2 Network Interface Names.
- Enable predictable network interface names. This is crucial for this tutorial!

We are working with the built-in WiFi (*wlan0*) and an external WiFi adapter (*wlx00c0caae6319*), which is the predictable interface name for the ALFA AWUS036ACM. By enabling predictable network interface names, we can reliably distinguish between the built-in and external WiFi adapters. Without this setting, the external WiFi card might occasionally be assigned wlan0 instead of the built-in WiFi, which could cause issues with our firewall and routing configurations.

* * *

## 04 USER ACCESS CONTROL

We establish separate admin and standard user accounts, following best security practices to limit privileges and reduce risks. The admin account (admin) is reserved for system maintenance and configuration, while the standard user account (term7) is used for everyday tasks with minimal permissions.

By enforcing the principle of least privilege (PoLP), we enhance security and minimize potential attack vectors: This setup allows us to disable root login via SSH, adding an extra layer of defense. Even if an attacker manages to gain access, they won’t have admin rights by default, significantly reducing the risk of system compromise.

#### 1. CREATE NEW ADMIN USER:

To create a dedicated admin account, run the following command:
```
sudo adduser admin
```

The only required detail is a strong password. We highly recommend using a password manager such as KeePassXC to store and manage your credentials securely.

If you prefer generating a strong password directly from the command line, use:
```
openssl rand -base64 48 | cut -c1-32
```

This command generates a 32-character random password using OpenSSL’s RNG, which follows NIST SP 800-90A/B/C standards and uses ChaCha20 (or AES-CTR in older versions), ensuring cryptographic strength. The output is unpredictable and highly resistant to brute-force attacks.

Once the admin user is created, add it to all essential groups to ensure it has access to required system functions:
```
sudo usermod -a -G adm,tty,dialout,cdrom,audio,video,plugdev,games,users,input,netdev,gpio,i2c,spi,sudo,term7 admin
```

#### 2. REMOVE SUDO PRIVILEGES FROM THE STANDARD USER:

To enhance security, remove sudo privileges from term7 and transfer them to admin, while ensuring that sudo now requires a password:

```
sudo sed -i 's/term7/admin/g' /etc/sudoers.d/010_pi-nopasswd
```
```
sudo sed -i 's/NOPASSWD: //g' /etc/sudoers.d/010_pi-nopasswd
```

To enhance security, we will remove our standard user (term7 in this example) from the sudo group, ensuring it no longer has administrative privileges. First, log in as the new admin user:
```
su admin
```

Now, execute the following command to remove term7 from the sudo group (replace term7 with your actual standard username):
```
sudo deluser term7 sudo
```

#### ALLOW THE STANDARD USER TO SHUTDOWN AND REBOOT YOUR RASPBERRY PI:

Although term7 no longer has full sudo access, we want to allow it to reboot and shut down the Raspberry Pi without switching to admin. Run the following command to create a new sudo policy file:
```
echo "term7 ALL = NOPASSWD: /usr/sbin/reboot, /usr/sbin/shutdown" | sudo tee /etc/sudoers.d/common_users > /dev/null
```

This grants term7 password-free access to the reboot and shutdown commands.
If you want to allow additional commands without requiring sudo, simply edit the file: `/etc/sudoers.d/common_users`

* * *

## 05 HARDEN SSH CONFIGURATION

By default, you can still SSH directly into your admin account, which is a security risk. To strengthen SSH security, we will modify the SSH configuration.

**Port Hardening**
- Change the default SSH port (to port 6666)

**Strong Cryptographic Algorithms:**
- Cyphers for strong encryption (chacha20-poly1305, aes256-gcm)
- Secure Key Exchange (curve25519-sha256, diffie-hellman-group16-sha512)
- MACs to protect against cryptographic vulnerabilities (hmac-sha2-512-etm)

**Strict Authentication Controls**
- Disable direct root login
- Restrict SSH access to specific users (term7)
- Limits Authentication Attempts & Sessions (MaxAuthTries 2, MaxSessions 2)
- Enforce SSH key authentication
- Disable Password Login
- Disable challenge-response authentication (prevents brute-force attacks)

**Session Hardening**
- Timeout and Inactivity Control (ClientAliveInterval 300, ClientAliveCountMax 2)
- Prevent Empty Password Logins

**Enhanced Logging and Monitoring**
- Logging: Capture failed authentication attempts, IP addresses, and suspicious activities
- Enable Warning Banner

#### Preparation: Setting Up SSH Key Authentication for Secure Access

SSH key authentication is more secure than password-based authentication. It uses a pair of cryptographic keys:

*Private key → Stays securely on your Mac.*<br>
*Public key → Is copied to your Raspberry Pi.*

Once configured, only your Mac can log into the Raspberry Pi — unless your private key is compromised.

#### 1. Generate a New SSH Key Pair on Your Mac

Open Terminal on your Mac and run:<br>
```
ssh-keygen -t ed25519 -C "your_email@example.com"
```

It uses the Ed25519 algorithm, which is faster and more secure than RSA. Please use your real email for reference.

**Advanced Security**<br>
For an even stronger setup, consider using a hardware security key such as a [Nitrokey](https://www.nitrokey.com/products/nitrokeys) or [YubiKey](https://www.yubico.com/products/yubikey-5-overview/). However, these require additional setup and are beyond the scope of this tutorial. We might cover them in a separate guide in the future.

#### 2. Copy the Public Key to Your Raspberry Pi

Run this command, replacing 192.168.1.123 with your Raspberry Pi’s actual local IP address:
```
ssh-copy-id -i ~/.ssh/id_ed25519.pub term7@192.168.1.123
```

If ssh-copy-id is not installed on macOS, manually copy the key using:
```
cat ~/.ssh/id_ed25519.pub | ssh term7@192.168.1.123 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys'
```

#### 3. Configure SSH on Your Mac for Easier Access

Still on your Mac, edit your SSH configuration file:
```
nano ~/.ssh/config
```

Make sure this line is present: `IdentityFile ~/.ssh/id_ed25519`

This ensures your Mac always uses the correct private key (id_ed25519) for authentication and prevents SSH from prompting for a password if key authentication is set up correctly.

#### 4. Log Back into Your Raspberry Pi Standard User Account

After setting up SSH key authentication, you need to set the correct permissions on your .ssh directory and the authorized_keys file to ensure SSH works securely:
```
ssh term7@192.168.1.123
```

Replace `192.168.1.123` with your actual Raspberry Pi IP!

#### 5. Set the Correct SSH Directory and File Permissions

In your standard user account, run the following commands on your Raspberry Pi:

```
chmod 700 ~/.ssh
```
```
chmod 600 ~/.ssh/authorized_keys
```

This ensures that only the user (term7) has access to the `.ssh` directory and that only the user can read and write `authorized_keys`.

#### 6. Setup Warning Banner

Now log into your admin account:
```
su admin
```

To display a security warning banner before login, download and replace the `/etc/issue.net` file with our pre-configured version from the repository:
```
sudo curl -L -o /etc/issue.net "https://codeberg.org/term7/Going-Dark/raw/branch/main/Pi%20Configuration%20Files/ssh/issue.net"
```

You can edit the banner text to match your requirements:
```
sudo nano /etc/issue.net
```

#### 7. Harden SSH configuration

The fastest way to harden your SSH configuration is to replace it with our pre-configured file from this repository.

However, before making any changes, create a backup to avoid getting locked out in case anything goes wrong. Run this command to create a backup:
```
sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak
```

If anything goes wrong, you can restore the original file. To download our hardened configuration, run this command:
```
sudo curl -L -o /etc/ssh/sshd_config "https://codeberg.org/term7/Going-Dark/raw/branch/main/Pi%20Configuration%20Files/ssh/sshd_config"
```

This overwrites your current standard SSH configuration file. **IMPORTANT**: If you use a different standard username than *term7*, you must update this line: `AllowUsers term7`

To check and edit the file before applying changes, open it in *Nano*:
```
sudo nano /etc/ssh/sshd_config
```

Find and replace `term7` with your actual username, then save (**CTRL + X**, then **Y**, then **Enter**).

#### 8. Apply and Test the New SSH Configuration

After making necessary changes, restart the SSH service:
```
sudo systemctl restart ssh
```

Do **NOT** log out yet! On your Mac, open a new terminal window and test SSH access:
```
ssh term7@192.168.1.123 -p 6666
```
Don't forget to replace `192.168.1.123` with your actual Raspberry Pi IP!

If the connection works fine, your new hardened SSH configuration is successfully applied!<br>
Since you are still logged in on your original terminal window, you can troubleshoot any issues if something doesn't work.

#### 9. Recover from an Issue (If Needed)

If something goes wrong and you do get locked out, restore your backup. Access your Raspberry Pi locally (use keyboard & monitor). Then type the following commands:

```
sudo cp /etc/ssh/sshd_config.bak /etc/ssh/sshd_config
```
```
sudo systemctl restart ssh
```

This will restore your previous working SSH configuration.

* * *

## 06 UNATTENDED UPGRADES

Keeping your Raspberry Pi up-to-date is crucial for security and stability. Instead of manually updating, we set up unattended upgrades to automatically install security and system updates. Since our Raspberry Pi is only powered on when we work on our Mac, we need to ensure updates run after every reboot. Additionally, because we will install *AdGuardHome* (which requires time to apply filter lists), we introduce a 2-minute delay before the update process starts.

#### 1. Install Required Packages:

To set up unattended upgrades, use the following command to install the required software packages:
```
sudo apt install -y unattended-upgrades apt-listchanges
```

#### 2. Enable Raspberry Pi OS Updates:

By default, Debian security updates are included. However, we need to add Raspberry Pi updates manually. Run this command to modify the `50unattended-upgrades` file:

```
sudo sed -i '/"origin=Debian,codename=${distro_codename}-security,label=Debian-Security";/a\
        "origin=Raspbian,codename=${distro_codename},label=Raspbian";\
        "origin=Raspberry Pi Foundation,codename=${distro_codename},label=Raspberry Pi Foundation";' /etc/apt/apt.conf.d/50unattended-upgrades
```

Also allow automatic upgrades of packages that come from the Debian repository:
```
sudo sed -i 's|^//\s*\("origin=Debian,codename=\${distro_codename}-updates"\);|\1;|' /etc/apt/apt.conf.d/50unattended-upgrades
```

Automatically remove unused dependencies: 

```
sudo sed -i 's|^//\s*Unattended-Upgrade::Remove-Unused-Dependencies\s*"false";|Unattended-Upgrade::Remove-Unused-Dependencies "true";|' /etc/apt/apt.conf.d/50unattended-upgrades
```

#### 3. Ensure Updates Run After Every Reboot:

Create a systemd timer that waits 2 minutes after boot before running updates:

```
echo '[Unit]
Description=Unattended Upgrades Timer

[Timer]
OnBootSec=2min
Unit=unattended-upgrades.service

[Install]
WantedBy=multi-user.target' | sudo tee /etc/systemd/system/unattended-upgrades.timer > /dev/null
```

This prevents updates from running too early while *AdGuardHome* is still initializing.<br>
Now, create the systemd service that will execute unattended upgrades:

```
echo '[Unit]
Description=Unattended Upgrades
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/bin/unattended-upgrade -d

[Install]
WantedBy=multi-user.target' | sudo tee /etc/systemd/system/unattended-upgrades.service > /dev/null
```

#### 4. Enable and Start the Timer

To activate the systemd timer and service, run:

```
sudo systemctl daemon-reload
```
```
sudo systemctl enable unattended-upgrades.timer
```
```
sudo systemctl start unattended-upgrades.timer
```

After rebooting, check if the timer is active:
```
systemctl list-timers --all | grep unattended-upgrades
```

If you see an entry, the timer is working.

To check if updates were applied, view the unattended upgrade logs:
```
journalctl -u unattended-upgrades --no-pager
```

* * *

## 07 DISABLE IPv6

While IPv6 offers advantages, using both IPv4 and IPv6 (dual-stack networking) significantly complicates firewall configurations and increases security risks.

#### Why disable IPv6?

- **Larger Attack Surface** → Both IPv4 and IPv6 require separate firewall rules, increasing complexity and risk of misconfiguration.
- **Tracking Risks** → IPv6 can embed a device's MAC address in its IP (EUI-64 format), allowing attackers and advertisers to track device movements across networks.
- **Privacy Concerns** → Without IPv6 Privacy Extensions, addresses remain static, reducing anonymity compared to dynamic IPv4 addresses.

Since we do not need IPv6, we will completely disable it to improve security and simplify network configurations.

#### 1. Disable IPv6 at System Level:

Permanently disable IPv6 by modifying `/etc/sysctl.conf`:
```
echo -e "\n# Disable IPv6:\nnet.ipv6.conf.all.disable_ipv6 = 1\nnet.ipv6.conf.default.disable_ipv6 = 1\nnet.ipv6.conf.lo.disable_ipv6 = 1" | sudo tee -a /etc/sysctl.conf > /dev/null
```

Modify boot parameters in `/boot/firmware/cmdline.txt` to prevent IPv6 from loading at boot:
```
sudo sed -i 's/$/ ipv6.disable=1/' /boot/firmware/cmdline.txt
```

For the changes to take effect, reboot the system:
```
sudo reboot now
```

#### 2. Remove IPv6 Entries from /etc/hosts:

Since IPv6 is now disabled, remove any local IPv6 addresses from `/etc/hosts` to prevent unnecessary resolution attempts:
```
sudo sed -i '/::/d' /etc/hosts
```

* * *

## 08 RANDOM MAC ADDRESS

By default, modern Raspberry Pi OS uses *NetworkManager* to handle network interfaces, DHCP, and Wi-Fi settings. To improve privacy and reduce the risk of tracking, we will enable *NetworkManager’s* built-in MAC address randomization feature.

#### 1. Enable MAC Address Randomization:

Create a configuration file to enable random MAC addresses for both Wi-Fi and Ethernet:

```
echo '[device]
wifi.scan-rand-mac-address=yes

[connection]
wifi.cloned-mac-address=random
ethernet.cloned-mac-address=random
connection.stable-id=${CONNECTION}/${BOOT}' | sudo tee /etc/NetworkManager/conf.d/00-randomize.conf > /dev/null
```

#### 2. Verify MAC Address Randomization:

To check if the MAC address is changing dynamically, run:
```
sudo nmcli device show | grep GENERAL.HWADDR
```

Now, reboot your Raspberry Pi:
```
sudo reboot now
```

After the system restarts, run the following command again:
```
sudo nmcli device show | grep GENERAL.HWADDR
```

If the MAC address differs from the previous output, the randomization setup is working correctly.

**⚠️ IMPORTANT: A side effect of MAC address randomization is that your router may assign a different IP address to your Raspberry Pi. If you're using SSH, you may need to check your Raspberry Pi’s new IP address and update your SSH connection accordingly.**

* * *

## 09 RANDOM HOSTNAME

Many networks log hostnames alongside MAC addresses and IP addresses. If your hostname remains static, it creates a consistent fingerprint that can be used to track your device across different networks. This means, even if MAC address randomization is enabled, a fixed hostname could still be used to identify your device. This is why we use an English Dictionary to pick a random word for our Raspberry Pi at each reboot before the network becomes online.

#### 1. Prepare File Locations and Download Dictionary

First we create the folders where we want to store our scripts and our dictionary:

```
[ -d ~/tools ] || mkdir ~/tools && [ -d ~/tools/dict ] || mkdir ~/tools/dict
```
```
[ -d ~/script ] || mkdir ~/script && [ -d ~/script/randhost ] || mkdir ~/script/randhost
```

Download and unzip our *UK English dictionary*:
```
curl -L https://codeberg.org/term7/Going-Dark/raw/branch/main/misc/Dictionary/ukenglish.zip -o ~/tools/dict/ukenglish.zip && unzip -o ~/tools/dict/ukenglish.zip -d ~/tools/dict/ && rm ~/tools/dict/ukenglish.zip
```

#### 2. Create the Script to Randomize the Hostname

Create the hostname randomization script:

```
echo '#!/bin/bash

# Random Hostname Generator
ALL_NON_RANDOM_WORDS=/home/admin/tools/dict/ukenglish.txt

# Count the number of words in the dictionary
non_random_words=$(wc -l < "$ALL_NON_RANDOM_WORDS")

# Generate a random index and select a word
WORD_INDEX=$(od -N3 -An -i /dev/urandom | awk -v r="$non_random_words" "{print int(1 + r * \$1 / 16777216)}")
NEW_HOSTNAME=$(sed -n "${WORD_INDEX}p" "$ALL_NON_RANDOM_WORDS")

# Change Static Hostname
hostnamectl set-hostname "$NEW_HOSTNAME"

# Update /etc/hosts safely
sed -i "/127.0.1.1/c\127.0.1.1       $NEW_HOSTNAME" /etc/hosts' | sudo tee /home/admin/script/randhost/hostname.sh > /dev/null
```

Ensure the script has the correct ownership and permissions:

```
sudo chmod 700 /home/admin/script/randhost/hostname.sh
```
```
sudo chown root:root /home/admin/script/randhost/hostname.sh
```

#### 3. Create a System Service to Run the Script on Boot

```
echo '[Unit]
Description=Random Hostname Generator
Wants=network-pre.target
After=network-pre.target

[Service]
Type=oneshot
ExecStart=/usr/bin/bash /home/admin/script/randhost/hostname.sh
RemainAfterExit=yes
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target' | sudo tee /etc/systemd/system/hostname.service > /dev/null
```
#### 4. Enable and Start the Service and Verify the New Hostname

Enable the service:

```
sudo systemctl daemon-reload
```
```
sudo systemctl enable hostname.service
```

#### 5. Test the Service

Manually start the service:
```
sudo systemctl start hostname.service
```

Check the current hostname:
```
hostname
```

If you see a different hostname than before, the setup is working correctly. From now on, your Raspberry Pi will randomly select a new hostname from the dictionary on each reboot.

* * *

## 10 SETUP USBC ETHERNET GADGET

In this section we will configure your Raspberry Pi as a *USB-C Ethernet Gadget*, allowing it to share its internet connection with your computer over USB.

To configure your Raspberry Pi as a *USB-C Ethernet Gadget*, we need to:

- Enable the DWC2 USB controller and configure kernel boot parameters.
- Allow NetworkManager to manage the USB interface (usb0).
- Configure usb0 with a static IP and disable IPv6.
- Enable IPv4 forwarding for network sharing.

#### 1. Enable the DWC2 USB Controller

To enable ethernet gadget mode, we need to enable the DWC2 USB controller and configure kernel boot parameters. Append the required overlay to `/boot/firmware/config.txt`:
```
sudo sed -i '$a\dtoverlay=dwc2,dr_mode=peripheral' /boot/firmware/config.txt
```

Modify `/boot/firmware/cmdline.txt` to load the required kernel modules:
```
sudo sed -i 's/$/ rootwait modules-load=dwc2,g_ether quiet/' /boot/firmware/cmdline.txt
```

#### 2. Allow NetworkManager to Manage usb0

By default, NetworkManager may ignore the gadget interface (*usb0*). We need to modify udev rules to allow it. First, copy and modify the required udev rules:

```
sudo cp /usr/lib/udev/rules.d/85-nm-unmanaged.rules /etc/udev/rules.d/85-nm-unmanaged.rules
```

Then, update the rule to ensure NetworkManager manages *usb0*:
```
sudo sed -i '/ENV{DEVTYPE}=="gadget"/s/ENV{NM_UNMANAGED}="1"/ENV{NM_UNMANAGED}="0"/' /etc/udev/rules.d/85-nm-unmanaged.rules
```

#### 3. Configure usb0 as a Static Interface in NetworkManager

We will assign a static IP (`192.168.77.1/24`) to *usb0* and enable network sharing.<br>
Create and configure the interface:

```
sudo nmcli con add type ethernet ifname usb0 con-name usb0-static
```
```
sudo nmcli con modify usb0-static ipv4.addresses 192.168.77.1/24 ipv4.method shared
```
```
sudo nmcli con modify usb0-static connection.autoconnect yes connection.autoconnect-priority 50
```

Since IPv6 is disabled globally, disable it for this interface as well:
```
sudo nmcli connection modify usb0-static ipv6.method disable
```

Ensure a consistent MAC address for *usb0*, the only interface for which we do not want MAC randomization:
```
sudo nmcli connection modify usb0-static ethernet.cloned-mac-address permanent
```

#### 4. Enable IPv4 Forwarding

To allow internet sharing from Raspberry Pi's Wi-Fi to the connected computer, enable IPv4 forwarding. Modify `/etc/sysctl.conf`:<br>
```
sudo sed -i 's/^#net.ipv4.ip_forward=1/net.ipv4.ip_forward=1/' /etc/sysctl.conf
```

This allows packet forwarding, enabling the Raspberry Pi to share its internet connection via *usb0*.

#### 5. Apply Changes and Reboot

For all changes to take effect, reboot your Raspberry Pi:<br>
```
sudo reboot now
```

#### 6. Verify Internet Access via Raspberry Pi USB-C Ethernet Gadget

After reboot, your Raspberry Pi should act as an *USB-C Ethernet Gadget* over USB.

Connect to the Raspberry Pi using the static IP address assigned to *usb0*:
```
ssh term7@192.168.77.1 -p 6666
```

Verify the connection on your computer: Go to **System Settings** → **Network** and look for **RNDIS/Ethernet Gadget**. You should see a green dot with the status: **Connected**.

Since your Raspberry Pi is connected to the internet via your home router, your computer should now access the internet via the Raspberry Pi. Turn off Wi-Fi on your Mac and check if you still have an internet connection.

* * *

## 11 SETUP WIRELESS HOTSPOT

In this setup, we want to configure *wlan0* as a wireless hotspot that can be started manually rather than running continuously. This provides greater control over network availability and helps optimize system performance.

Since we do not want *wlan0* to be used for internet access, we will configure our external Wi-Fi adapter — the **ALFA AWUS036ACM** — to handle the internet connection instead.

#### Why Use an External Wi-Fi Adapter?

The **ALFA AWUS036ACM** provides significantly better bandwidth compared to the Raspberry Pi’s built-in Wi-Fi (*wlan0*), especially when connected to a USB 3.0 port. Using an external adapter ensures faster speeds and improved stability, making it the preferred choice for connecting to the internet.

Because we enabled predictable network interface names (see [03 - PREREQUISITES](#03-prerequisites)), our external Wi-Fi adapter is assigned the interface name: *wlx00c0caae6319*

**⚠️ Important: If you are using a different external Wi-Fi adapter, its interface name will be different. You should replace *wlx00c0caae6319* with your actual interface name throughout this tutorial, in all firewall configuration files and any network-related commands or settings.**

#### 1. Verify Your External Wi-Fi Adapter:

Before proceeding, make sure your external Wi-Fi adapter is plugged in and properly connected to your Raspberry Pi. To find out the interface name of your Wi-Fi adapters, run the following command:
```
nmcli device status
```

Look for your external Wi-Fi adapter in the output. It will typically have a name starting with *wlx* or *wlan*. If you're unsure which one your external adapter is, compare it to the built-in Wi-Fi (*wlan0*). The external one will have a different name.

#### 2. Rename Preconfigured External Connections and Disable IPv6:

To standardize connection names, run:

```
sudo nmcli con modify preconfigured connection.id "Wi-Fi"
```
```
sudo nmcli con modify "Wired connection 1" connection.id "Ethernet"
```

Disable IPv6 on both connections:

```
sudo nmcli connection modify Ethernet ipv6.method disable
```
```
sudo nmcli connection modify Wi-Fi ipv6.method disable
```

#### 3. Configure External Wi-Fi Adapter (wlx00c0caae6319) for Internet Access:

Modify the Wi-Fi connection to use the external adapter:

```
sudo nmcli con down Wi-Fi
```
```
sudo nmcli con modify Wi-Fi ifname wlx00c0caae6319
```

**⚠️ Warning: Use the actual predictable interface name of your own Wi-Fi adapter!**

Start the external Wi-Fi connection:
```
sudo nmcli con up Wi-Fi
```

Now, your external Wi-Fi adapter should be handling the internet connection instead of *wlan0*.

#### 4. Create the wlan0 Hotspot:

Add a new hotspot connection (SSID: ONION):<br>
```
sudo nmcli con add con-name Hotspot ifname wlan0 type wifi ssid "ONION"
```

Configure the hotspot as an access point with network sharing:
```
sudo nmcli con modify Hotspot 802-11-wireless.mode ap 802-11-wireless.band bg ipv4.method shared
```
```
sudo nmcli con modify Hotspot ipv4.addresses 192.168.37.1/24
```

Set up Wi-Fi security for the hotspot:

```
sudo nmcli con modify Hotspot wifi-sec.key-mgmt wpa-psk
```
```
sudo nmcli con modify Hotspot wifi-sec.proto rsn
```
```
sudo nmcli con modify Hotspot wifi-sec.pairwise ccmp
```
```
sudo nmcli con modify Hotspot wifi-sec.group ccmp
```
```
sudo nmcli con modify Hotspot wifi-sec.auth-alg open
```
```
sudo nmcli con modify Hotspot wifi-sec.pmf optional
```
```
sudo nmcli con modify Hotspot wifi-sec.psk "your-own-strong-wifi-password"
```

Disable IPv6 for the hotspot:
```
sudo nmcli connection modify Hotspot ipv6.method disable
```

Prevent automatic connection at startup:
```
sudo nmcli connection modify Hotspot connection.autoconnect no
```

The hotspot is now configured, but will only start when manually enabled.

#### 5. TEST: Connect Your Devices to the Hotspot:

To start the hotspot:
```
sudo nmcli con up Hotspot
```

To stop the hotspot:
```
sudo nmcli con down Hotspot
```

Your Raspberry Pi is now acting as a manually controlled wireless hotspot.<br>
After starting the hotspot, you can connect your smartphone or other devices using:

- SSID: *ONION*
- Password: *"your-own-strong-wifi-password"*

* * *

## 12 SETUP NTP

By default, the Raspberry Pi synchronizes time using the Debian NTP pool servers. However, we want to set up a local NTP server on the Raspberry Pi to provide network time synchronization for connected clients. Additionally, we will configure our Raspberry Pi to use privacy-respecting external NTP servers from the *NTP Pool Project*, ensuring accurate and secure time synchronization. By doing so, our Mac will synchronize time through the Raspberry Pi instead of contacting *time.apple.com*, further limiting Apple’s ability to track our device based on time synchronization requests.

For more details, visit: [NTP Pool Project](https://www.ntppool.org/en/use.html)

#### 1. Install NTP:

First, install the NTP package. This will automatically remove *systemd-timesyncd*, which is the default time synchronization service on the Raspberry Pi:

```
sudo apt install -y ntp
```

#### 2. Download & Apply NTP Configuration:

To simplify the setup, download our pre-configured NTP configuration file from our repository:
```
sudo curl -L -o /etc/ntpsec/ntp.conf "https://codeberg.org/term7/Going-Dark/raw/branch/main/Pi%20Configuration%20Files/ntp/ntp.conf"
```

This configuration:<br>
- Sets up the Raspberry Pi as an NTP server for local network clients.
- Uses multiple external time servers for redundancy.
- Prevents major time synchronization issues after long offline periods.


#### 3. Potential Issues:

If the Raspberry Pi remains offline for an extended period, its internal clock may drift significantly. Our current settings prevent NTP from rejecting its own local clock after long downtimes. Without these settings, a large time discrepancy could cause the Raspberry Pi to become unable to connect to the internet.<br>
If the Raspberry Pi loses internet access, it will continue serving time to local clients based on the last known good sync. However, over time, clock drift errors may accumulate, potentially affecting internet connectivity and secure connections (e.g., TLS/SSL certificates may become invalid due to incorrect system time). To mitigate this issue, we strongly recommend installing a Real-Time Clock (RTC) module, that keeps track of time even when the device is powered off.

Even though local clients are allowed to sync from the Raspberry Pi, they may still prefer external NTP servers such as Apple, Google, or Microsoft. To ensure all network devices use the Raspberry Pi for time synchronization, we will later configure NetworkManager to use its built-in dnsmasq as a DHCP server. This setup broadcasts the Raspberry Pi's NTP settings to all DHCP clients, ensuring they automatically use the Raspberry Pi for time synchronization. It should eliminate the need for manual configuration on each device.

However, if you want to configure your Mac to use the Raspberry Pi as its NTP server, open a new terminal window on your Mac and disable automatic time setting for the moment:<br>
```
sudo systemsetup -setusingnetworktime off
```

Note: This command may produce *'Error:-99'* due to Apple's System Integrity Protection (SIP). However, despite this error, our testing has shown that the setting is still applied correctly.

The next command is a bit of a hack because Apple does not document support for multiple lines in this command. Officially, systemsetup -setnetworktimeserver only accepts a single line. However, despite being undocumented, this method does not produce errors and correctly formats the configuration file in our experience. We want to set up the [NTP Pool Project](https://www.ntppool.org/en/use.html) as secondary servers if the Raspberry Pi Ethernet Gadget is not available:

```
sudo systemsetup -setnetworktimeserver "192.168.77.1
server 0.pool.ntp.org
server 1.pool.ntp.org
server 2.pool.ntp.org
server 3.pool.ntp.org"
```

If you prefer to avoid this undocumented method, you can manually enter multiple time servers in **System Settings > Date & Time**. Separate each entry with a comma and end each with a period, e.g.:
`192.168.77.1, 0.pool.ntp.org, 1.pool.ntp.org, 2.pool.ntp.org, 3.pool.ntp.org`

If you only want to synchronise time via your Raspberry Pi and adhere to the correct syntax as documented by Apple, use this command instead:
```
sudo systemsetup -setnetworktimeserver "192.168.77.1"
```

Finally re-enable automatic time setting:
```
sudo systemsetup -setusingnetworktime off
```

Verify whether automatic time setting is enabled:
```
sudo systemsetup -getusingnetworktime
```

To check if macOS is using the correct settings, run:
```
sudo systemsetup -getnetworktimeserver
```

However, this command only returns the first server in the list!

#### 4. Optional - Install an RTC Module for Reliable Offline Timekeeping:

In this guide, we will set up the [RV3028 RTC Module](https://shop.pimoroni.com/products/rv3028-real-time-clock-rtc-breakout?variant=27926940549203). If you use a different RTC module, follow the respective installation instructions. Make sure you are connected to your Raspberry Pi via SSH and logged into your *admin* account.

Install required packages:
```
sudo apt install -y git python3-smbus
```

Create a build directory and navigate into it:
```
[ -d ~/build ] || mkdir ~/build && cd ~/build
```

Clone & Install the RV3028 Python Library:
```
git clone https://github.com/pimoroni/rv3028-python
```
```
cd rv3028-python
```
```
sudo ./install.sh --unstable
```

Move example scripts to a dedicated folder:
```
sudo mv ~/Pimoroni/* ~/build/rv3028-python/examples
```
```
sudo rm -R /home/admin/Pimoroni
```

Enable I2C communication:
```
sudo sed -i 's/^#dtparam=i2c_arm=on/dtparam=i2c_arm=on/' /boot/firmware/config.txt
```

Furthermore, to enable the RV3028 RTC, we need to load the correct kernel overlay. Run the following command to insert the required overlay into `/boot/firmware/config.txt`:
```
sudo sed -i '0,/^\[all\]/s//&\ndtoverlay=i2c-rtc,rv3028,backup-switchover-mode=1/' /boot/firmware/config.txt
```

Reboot your Raspberry Pi for changes to take effect:
```
sudo reboot now
```

The Raspberry Pi uses a software-based fake hardware clock by default. Since we now have a real RTC, remove it to avoid conflicts:

```
sudo apt -y remove fake-hwclock
```
```
sudo update-rc.d -f fake-hwclock remove
```

Finally, configure NTP (ntpsec) to read time from the RTC module:
```
sudo sed -i 's/^#rtcfile \/dev\/rtc0/rtcfile \/dev\/rtc0/' /etc/ntpsec/ntp.conf
```

Restart NTP to apply changes:
```
sudo systemctl restart ntpsec
```

* * *

## 13 PREPARE DNSMASQ

**⚠ IMPORTANT: Completing chapters 13 - 19 step by step in the correct order is crucial! Any misconfiguration could cause DNS issues, potentially leading to loss of internet connectivity for your Raspberry Pi and its connected clients — or even lock you out completely. Even small mistakes or skipped steps may result in certain aspects of the setup not working as expected. Proceed carefully and follow each step precisely.**

In this section, we will configure NetworkManager’s built-in Dnsmasq to manage both DHCP and DNS services.

Our goals:

- Redirect all DNS queries from port 53 to port 5357, where *AdGuardHome* will handle them.
- Assign DHCP leases to devices connecting via *usb0* (Ethernet Gadget) and *wlan0* (Wi-Fi Hotspot).
- Ensure clients pass their hostnames for improved logging in *AdGuardHome*.
- Assign a static IP address to our Mac (WORKSTATION) so that *AdGuardHome* consistently identifies it.
- Advertise our local NTP server to all connected clients for synchronized timekeeping.

By setting up *Dnsmasq* correctly, we will establish a secure, private, and reliable local DNS and DHCP system, ensuring smooth operation and seamless device identification.

#### 1. Configure NetworkManager:

To properly manage DHCP and DNS with *NetworkManager*, we first need to configure its general settings and then set up *Dnsmasq* for both standard and shared network interfaces.

Run the following command to create and update `/etc/NetworkManager/NetworkManager.conf`:

```
echo '[main]
plugins=ifupdown,keyfile
dns=dnsmasq
dhcp=dnsmasq

[ifupdown]
managed=false' | sudo tee /etc/NetworkManager/NetworkManager.conf > /dev/null
```

This ensures that *NetworkManager* uses *Dnsmasq* for DHCP and DNS.

#### 2. Configure Dnsmasq:

*NetworkManager* uses two different configuration folders for Dnsmasq:

- *Standard Interfaces* (`/etc/NetworkManager/dnsmasq.d/`) → Used for *lo* (localhost).
- *Shared Interfaces* (`/etc/NetworkManager/dnsmasq-shared.d/`) → Used for shared networks like *wlan0* and *usb0*.

We need to configure both.

Create the following configuration file to ensure that all DNS requests are forwarded to *AdGuardHome* and apply security features:

```
echo '# Redirect DNS to Adguard (localhost)
proxy-dnssec
server=127.0.0.1#5357
no-resolv
edns-packet-max=1232

# Prevent DNS leaks and block Bogus Private IP Responses
domain-needed
bogus-priv

# Prevent DNS rebinding attacks
stop-dns-rebind

# Prevent External Access to Local DNS
local-service

# Ensure Hostnames Resolve Properly
expand-hosts' | sudo tee /etc/NetworkManager/dnsmasq.d/00_dnsmasq-adguard.conf > /dev/null
```

Create a configuration file for shared interfaces to redirect DNS queries to *AdGuardHome* and enable EDNS Client Subnet (ECS):

```
echo '# Redirect DNS to Adguard
proxy-dnssec
server=127.0.0.1#5357
no-resolv

# Enable EDNS Client Subnet (ECS) to pass client details
add-mac
add-subnet=32,128
edns-packet-max=1232

# Prevent DNS leaks and block Bogus Private IP Responses
domain-needed
bogus-priv

# Prevent DNS rebinding attacks
stop-dns-rebind

# Prevent External Access to Local DNS
local-service

# Ensure Hostnames Resolve Properly
expand-hosts' | sudo tee /etc/NetworkManager/dnsmasq-shared.d/00_dnsmasq-shared_adguard.conf > /dev/null
```

Set up DHCP settings for *usb0* (Ethernet Gadget) and *wlan0* (Wi-Fi hotspot):

```
echo '########################################
# DHCP/DNS for usb0 -> ONlY ONE CLIENT #
########################################

# Assign static IP to WORKSTATION:
dhcp-host=WORKSTATION,192.168.77.77

# DHCP range:
dhcp-range=set:usb0,192.168.77.10,192.168.77.255,255.255.255.0,24h

# Default Gateway:
dhcp-option=tag:usb0,3,192.168.77.1

# DNS server:
dhcp-option=tag:usb0,6,192.168.77.1

# NTP server:
dhcp-option=tag:usb0,option:ntp-server,192.168.77.1

# Request hostnames:
dhcp-option=tag:usb0,12

############################################
# DHCP/DNS for wlan0 -> REQUEST  HOSTNAMES #
############################################

# DHCP range:
dhcp-range=set:wlan0,192.168.37.10,192.168.37.250,255.255.255.0,24h

# Default Gateway:
dhcp-option=tag:wlan0,3,192.168.37.1

# DNS server:
dhcp-option=tag:wlan0,6,192.168.37.1

# NTP server:
dhcp-option=tag:wlan0,option:ntp-server,192.168.37.1

# Request hostnames:
dhcp-option=tag:wlan0,12' | sudo tee /etc/NetworkManager/dnsmasq-shared.d/01_usb0-wlan0.conf > /dev/null
```

IMPORTANT: These changes will take effect only after restarting *NetworkManager*. However, since you are connected via SSH, restarting *NetworkManager* would break your connection. The only way to apply these changes without losing access is a full system reboot.

**⚠ Do NOT reboot your Raspberry Pi at this stage!**

*AdGuardHome* and *Unbound* have not yet been configured, and no firewall rules are in place to ensure proper network routing. Rebooting now could disrupt connectivity. Continue with the remaining setup steps before restarting.**

#### 3. WORKSTATION as Hostname for your Mac:

To ensure your Mac appears as a distinct client in AdGuardHome, we need to assign it a static IP address (see configuration above). However, because MAC address randomization is enabled on your Mac, its MAC address cannot serve as a reliable identifier. Instead, we will set a fixed hostname — **WORKSTATION** — which will allow us to consistently assign the desired static IP. Open a Terminal on your Mac and run the following commands to configure the hostname:

```
sudo scutil --set HostName WORKSTATION
```
```
sudo scutil --set LocalHostName WORKSTATION
```
```
sudo scutil --set ComputerName WORKSTATION
```
```
dscacheutil -flushcache
```

#### 4. FIX: Clear USB0 Leases

When MAC address randomization is enabled, *Dnsmasq* may assign a different IP address upon reboot because it sees a new MAC address. To ensure that *AdGuardHome* consistently recognizes WORKSTATION with the correct static IP, we need to clear the `/var/lib/NetworkManager/dnsmasq-usb0.leases` file before *NetworkManager* starts.

Logged into your Raspberry Pi as *admin*, create the Cleanup Script:

```
echo '#!/bin/bash
> /var/lib/NetworkManager/dnsmasq-usb0.leases' | sudo tee ~/script/DNS/clear-usb0-leases.sh > /dev/null
```

Make the script executable:
```
sudo chmod +x ~/script/DNS/clear-usb0-leases.sh
```

Create a systemd service that runs this script before *NetworkManager* is started:

```
echo '[Unit]
Description=Clear dnsmasq leases for usb0
After=local-fs.target
Before=NetworkManager.service

[Service]
Type=oneshot
ExecStart=/home/admin/script/DNS/clear-usb0-leases.sh

[Install]
WantedBy=multi-user.target' | sudo tee /etc/systemd/system/clear-dnsmasq-leases.service > /dev/null
```

Reload systemd and enable the service so it runs at every shutdown:
```
sudo systemctl daemon-reload
```
```
sudo systemctl enable clear-dnsmasq-leases.service
```

Now, each time your Raspberry Pi starts, the `dnsmasq-usb0.leases` file will be cleared before *NetworkManager* takes over. This ensures *dnsmasq* assigns the correct static IP to your WORKSTATION, even if MAC randomization is enabled.

* * *

## 14 PREPARE UNBOUND

**⚠ IMPORTANT: Completing chapters 13 - 19 step by step in the correct order is crucial! Any misconfiguration could cause DNS issues, potentially leading to loss of internet connectivity for your Raspberry Pi and its connected clients — or even lock you out completely. Even small mistakes or skipped steps may result in certain aspects of the setup not working as expected. Proceed carefully and follow each step precisely.**

*Unbound* is a validating (DNSSEC) and recursive DNS server that caches queries to improve efficiency. Later, we will configure *AdGuardHome* to use *Unbound* as its sole upstream DNS server. The primary concern with traditional DNS resolvers is trust. When using a third-party DNS provider, we must trust that they are not recording, analyzing, or selling our DNS query data. By deploying *Unbound*, we eliminate this dependency, gaining the following advantages:

**PRIVACY:** *Unbound* performs full recursive resolution, meaning it starts the DNS lookup process at the root name servers and follows the hierarchy until it reaches the authoritative name server responsible for the requested domain. This eliminates reliance on a centralized DNS middleman that could log or analyze our queries.

**SPEED:** *AdGuardHome* already includes a built-in DNS cache, but combining it with *Unbound’s* advanced caching features—such as aggressive-nsec, prefetch, and serve-expired—further reduces query response times and enhances overall performance.

**DRAWBACK:** Lack of Encryption

One major downside of avoiding a DNS middleman is the lack of encryption. Queries to root name servers and authoritative DNS servers are sent in plain text over UDP/TCP on port 53, making them susceptible to interception and analysis.<br>
To mitigate this risk, one option is to encrypt DNS queries using DNS-over-TLS (DoT). However, in the setup described here, we will not use this option because root name servers do not (yet) support DoT or DoH (DNS-over-HTTPS).<br>
This means that if we choose to avoid third-party DNS resolvers, we must also forgo encryption. That said, DNSSEC (enabled in *Unbound*) still provides security benefits by ensuring that DNS responses are authentic (coming from the legitimate DNS server) and untampered (ensuring data integrity). While this does not encrypt queries, it does prevent DNS spoofing and man-in-the-middle attacks by verifying that responses are legitimate.

Eventually this is how the chain of DNS requests will work:

*Dnsmasq*: port 53 → *AdGuardHome*: port 5357 → *Unbound*: port 7353:

```
+----------------------+        +----------------------+        +-------------------+
|     User Device      |  DNS   |  NetworkManager DNS  |  DNS   |    AdGuardHome    |
| (Any App or Browser) | -----> |     dnsmasq: 53      | -----> |  Filtering: 5357  |
+----------------------+        +----------------------+        +-------------------+
                                                                      |
                                                                      | DNS
                                                                      v
                                                       +----------------------------+
                                                       |         Unbound            |
                                                       |  Recursive Resolver: 7353  |
                                                       |  - DNSSEC Validation       |
                                                       |  - Root-to-Auth Resolution |
                                                       |  - Caching Enabled         |
                                                       +----------------------------+
```

This is a diagram of how *Unbound* handles DNS requests - in this example, a client wants to visit *term7.info*:

```
   +-------------------+                     +------------------------+
   |                   |                     |                        |
   |  Client: Browser  | ------------------->|   https://term7.info   |
   |                   |                     |                        |
   +-------------------+                     +------------------------+
             ^
            ||
term7.info? || IP: 89.147.108.191
            ||
            v
   +------------------+                                        +------------+ 
   |   AdGuardHome    |                          /------------>|    Root    |
   |  Filter + Cache  |                         //------------ |   Server   |
   +------------------+                .info?  //              +------------+ 
             ^                                //
            ||                               //
term7.info? || IP: 89.147.108.191           // .info!
            ||                             //
            v                             //
   +-------------------+  ---------------//  	  
   |      Unbound      | <---------------/    term7.info?      +--------------------------+ 
   |                   |  ------------------------------------>|        TLD Server        |
   | Recursive Caching | <------------------------------------ | Top Level Domain:  .info |
   |  Resolver DNSSEC  |  ---------------\    term7.info!      +--------------------------+
   +-------------------+ <---------------\\
                                          \\
                                           \\
                                            \\ term7.info -> IP? 
                                             \\
                          IP: 89.147.108.191  \\
                                               \\              +-------------------------------+
                                                \\------------>|   Authoritative Name Server   |
                                                 \------------ |           term7.info          |
                                                               +-------------------------------+
```

#### 1. Install Unbound:

```
sudo apt install -y unbound unbound-anchor
```

Our *Unbound* configuration is designed for a privacy-focused, high-performance recursive DNS resolver with DNSSEC validation, enhanced caching, and security hardening. Download our pre-configured *Unbound* configuration file from our repository:<br>

#### 2. Unbound Main Configuration:

```
sudo curl -L -o /etc/unbound/unbound.conf.d/unbound-dnssec.conf "https://codeberg.org/term7/Going-Dark/raw/branch/main/Pi%20Configuration%20Files/unbound/unbound-dnssec.conf"
```

**Privacy & Security Features:**

- Eliminates reliance on external DNS providers by performing full recursive resolution (queries start at root servers).
- Prevents DNS leaks by blocking queries for local/private IPs.
- Enhances DNSSEC validation to ensure authenticity of DNS responses.
- Defends against DNS spoofing and rebinding attacks.
- Limits query data exposure to upstream servers with QNAME minimization.
- Blocks metadata requests to obscure server details.
- Implements rate limiting to prevent abuse.

**Performance Enhancements:**

- Aggressive caching with long TTLs.
- Prefetching enabled to speed up repeated queries.
- Optimized threading & memory usage
- Minimizes DNS response sizes to reduce network overhead.

#### 3. Unbound Local Configuration:

Next, we will create a second configuration file to define local zones and enable reverse lookups for *wlan0* and *usb0*, allowing local hostname resolution within our network:

```
echo 'server:
    # Serve static local websites:
    local-zone: "adguard.home." static
    local-data: "adguard.home. IN A 192.168.77.1"

    #PTR Record for localhost
    local-data-ptr: "127.0.0.1 localhost"
    
    # Allow reverse lookups for wlan0 (192.168.37.x)
    local-zone: "37.168.192.in-addr.arpa." transparent
    local-data-ptr: "192.168.37.1 hotspot.local"

    # Allow reverse lookups for usb0 (192.168.77.x)
    local-zone: "77.168.192.in-addr.arpa." transparent
    local-data-ptr: "192.168.77.1 usb0.local"

# Allow Unbound to read hostnames from DHCP leases
auth-zone:
    name: "37.168.192.in-addr.arpa."
    zonefile: "/var/lib/unbound/unbound-wlan0.zone"
        fallback-enabled: yes

auth-zone:
    name: "77.168.192.in-addr.arpa."
    zonefile: "/var/lib/unbound/unbound-usb0.zone"
    fallback-enabled: yes' | sudo tee /etc/unbound/unbound.conf.d/local-zones.conf > /dev/null
```

This configuration is particularly useful for the following reasons:

*AdGuardHome* will be able to log client hostnames (if provided by the client). This allows us to see which client is connecting to which domain in the query log.<br>
Later in this guide, we will configure an *Nginx Reverse Proxy* to serve the *AdGuardHome* web interface. Having local hostname resolution ensures that the web interface can be accessed reliably via a local domain name instead of an IP address.

#### 4. Translate Dnsmasq DHCP-leases into Unbound Zone File:

This setup does not work out of the box due to two key issues: *Dnsmasq* generates a zone file that is incompatible with *Unbound’s* syntax. To resolve this, we need a script that translates the lease file into a format that *Unbound* can read.<br>
Furthermore *Dnsmasq* needs to trigger this script whenever a new client connects. This ensures automatic updates to *Unbound’s* zone file, keeping hostname resolution accurate.

Prepare the Script Storage Location:<br>
```
[ -d ~/script ] || mkdir ~/script && [ -d ~/script/DNS ] || mkdir ~/script/DNS
```

Now, create the script that translates *NetworkManager’s* lease file into a format that is compatible with *Unbound*:

```
sudo tee /home/admin/script/DNS/update-unbound-leases.sh > /dev/null << 'EOF'
#!/bin/bash

# Loop through each interface (wlan0 and usb0)
for iface in wlan0 usb0; do
    # Define lease file and corresponding Unbound zone file paths for the interface
    LEASE_FILE="/var/lib/NetworkManager/dnsmasq-${iface}.leases"
    UNBOUND_ZONE_FILE="/var/lib/unbound/unbound-${iface}.zone"

    # If the lease file doesn't exist or is empty, create a placeholder zone file
    if [[ ! -s "$LEASE_FILE" ]]; then
        echo "; Unbound generated zone file - No active leases found" > "$UNBOUND_ZONE_FILE"
        continue
    fi

    # Initialize a new Unbound zone file with a header comment
    echo "; Unbound generated zone file from dnsmasq leases" > "$UNBOUND_ZONE_FILE"

    # Process each lease entry in the lease file
    while read -r LEASE_TIME MAC_ADDR IP HOSTNAME CLIENTID; do
        # Skip the entry if the IP address is missing
        if [[ -z "$IP" ]]; then
            continue
        fi

        # Set hostname to 'UNKNOWN' if it's missing or a placeholder '*'
        if [[ -z "$HOSTNAME" || "$HOSTNAME" == "*" ]]; then
            HOSTNAME="UNKNOWN"
        fi

        # Convert the IP address into PTR record format (reverse order)
        PTR_IP=$(echo "$IP" | awk -F. '{print $4"."$3"."$2"."$1}')
        # Append the PTR record to the Unbound zone file
        echo "$PTR_IP.in-addr.arpa. 86400 IN PTR $HOSTNAME." >> "$UNBOUND_ZONE_FILE"
    done < "$LEASE_FILE"
done

# Reload Unbound to apply the updated zone files
systemctl reload unbound
EOF
```

Make this script executable:
```
sudo chmod +x ~/script/DNS/update-unbound-leases.sh
```

Configure *Dnsmasq* to run the script automatically whenever a client connects:

```
echo "" | sudo tee -a /etc/NetworkManager/dnsmasq-shared.d/00_dnsmasq-shared_adguard.conf > /dev/null
```
```
echo "# Script to reconfigure Unbound zonefile for PTR requests" | sudo tee -a /etc/NetworkManager/dnsmasq-shared.d/00_dnsmasq-shared_adguard.conf > /dev/null
```
```
echo "dhcp-script=/home/admin/script/DNS/update-unbound-leases.sh" | sudo tee -a /etc/NetworkManager/dnsmasq-shared.d/00_dnsmasq-shared_adguard.conf > /dev/null
```

#### 5. Enforcing Local DNS and Updating Hosts:

To ensure all DNS queries are routed through *AdGuardHome* and *Unbound*, we need to configure *NetworkManager* to use our local resolver:

```
sudo nmcli con modify Wi-Fi ipv4.dns 127.0.0.1
```
```
sudo nmcli con modify Ethernet ipv4.dns 127.0.0.1
```

#### 6. FIX: Automatically Restore Unbound Configuration on Reboot:

Later in this guide, we’ll configure both a [WIREGUARD VPN](#21-wireguard-vpn) and a [TOR TRANSPARENT PROXY](#22-tor-transparent-proxy). Each of these modes requires dynamic modifications to your *Unbound* DNS configuration.

However, in rare cases — for example, if your Raspberry Pi crashes or you forget to shut down *WireGuard* or *Tor* properly — the system may reboot with an incorrect *Unbound* configuration. This can lead to a loss of internet connectivity on startup.

To prevent this, we’ll create a simple script and systemd service that automatically restores the default *Unbound* settings each time your Raspberry Pi boots.

Create a new script that resets Unbound to its default DNSSEC-secure configuration:

```
sudo tee /home/admin/script/DNS/restore-unbound-config.sh << 'EOF'
#!/bin/bash

# Config Files
UNBOUND_MAIN_CONFIG="/etc/unbound/unbound.conf.d/unbound-dnssec.conf"
UNBOUND_CONFIG="/etc/unbound/unbound.conf.d/local-zones.conf"

# Restore Unbound main configuration
sed -i 's/do-not-query-localhost: no/do-not-query-localhost: yes/' "$UNBOUND_MAIN_CONFIG"
sed -i 's/val-permissive-mode: yes/val-permissive-mode: no/' "$UNBOUND_MAIN_CONFIG"

# Remove TorProxy or WireGuard DNS Config and add fallback setting
sed -i '/fallback-enabled: yes/,$d' "$UNBOUND_CONFIG"
echo "        fallback-enabled: yes" >> "$UNBOUND_CONFIG"
EOF
```

Make the script executable:
```
sudo chmod +x ~/script/DNS/restore-unbound-config.sh
```

Now, create a new service unit to run the script before *Unbound* starts:

```
echo '[Unit]
Description=Restore Unbound configuration before Unbound starts
After=network.target
Before=unbound.service

[Service]
Type=oneshot
ExecStart=/home/admin/script/DNS/restore-unbound-config.sh

[Install]
WantedBy=multi-user.target' | sudo tee /etc/systemd/system/restore-unbound-config.service > /dev/null
```

Reload `systemd` and enable the service so that it runs on every boot:
```
sudo systemctl daemon-reload
```
```
sudo systemctl enable restore-unbound-config.service
```

From now on, your Raspberry Pi will automatically restore the correct *Unbound* configuration on startup — ensuring internet connectivity, even if the system previously shut down unexpectedly or with the wrong network mode active.

* * *

## 15 PREPARE ADGUARDHOME 

**⚠ IMPORTANT: Completing chapters 13 - 19 step by step in the correct order is crucial! Any misconfiguration could cause DNS issues, potentially leading to loss of internet connectivity for your Raspberry Pi and its connected clients — or even lock you out completely. Even small mistakes or skipped steps may result in certain aspects of the setup not working as expected. Proceed carefully and follow each step precisely.**

We will now install *AdGuardHome* - a powerful DNS sinkhole that filters ads, tracking domains, and malicious websites. It enhances privacy and security for all connected devices by blocking unwanted content at DNS level.

#### 1. Install AdGuardHome:

Before installing *AdGuardHome*, make sure the build directory exists and navigate into it:
```
[ -d ~/build ] || mkdir ~/build && cd ~/build
```

Run the following command to download and extract the latest *AdGuardHome* release:
```
curl -sSL https://github.com/AdguardTeam/AdGuardHome/releases/latest/download/AdGuardHome_linux_arm64.tar.gz | tar -xz
```

Then, navigate into the extracted directory and start the installation:
```
cd AdGuardHome && sudo ./AdGuardHome -s install
```

**Note: We will configure *AdGuardHome* later in the guide. At this stage, the installation is only preparing the system.**

* * *

## 16 SSL CERTIFICATE

**⚠ IMPORTANT: Completing chapters 13 - 19 step by step in the correct order is crucial! Any misconfiguration could cause DNS issues, potentially leading to loss of internet connectivity for your Raspberry Pi and its connected clients — or even lock you out completely. Even small mistakes or skipped steps may result in certain aspects of the setup not working as expected. Proceed carefully and follow each step precisely.**

In the previous chapters, we configured *NetworkManager's* built-in *Dnsmasq*, enabled reverse lookups via *Unbound* and installed *AdGuardHome*. Now, we need to set up encryption using a self-signed certificate, which will be used by *NGINX* to serve *adguard.home* over HTTPS.<br>
The goal is to access the *AdguardHome Web Interface* using the local address: [https://adguard.home](https://adguard.home)<br>
Additionally, this certificate will allow *AdGuardHome* to support encrypted DNS queries via DNS-over-HTTPS (DoH) as a fallback method alongside our *Unbound* configuration.

#### 1. Ensure Required Directories Exist:

Run the following command to ensure the required directories exist:
```
mkdir -p ~/tools/CA/SSL ~/script/SSL
```

#### 2. Create a Self-Signed Certificate Authority (CA):

Navigate to the *Certificate Authority (CA)* configuration folder:
```
cd ~/tools/CA
```

Create a self-signed *Certificate Authority (CA)* key and certificate (valid 10 years, Apple-compliant):
```
openssl req -x509 -new -nodes \
  -newkey rsa:2048 \
  -keyout term7-CA.key \
  -out term7-CA.pem \
  -days 3650 \
  -subj "/CN=term7-CA" \
  -addext "basicConstraints=critical,CA:true,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"
```

#### 3. Generate SSL Certificates for adguard.home:

Move into the SSL configuration directory:
```
cd ~/tools/CA/SSL
```

Create an *OpenSSL Configuration File* for *adguard.home*:

```
echo '[ req ]
default_bits       = 2048
default_md         = sha256
prompt             = no
distinguished_name = req_distinguished_name
req_extensions     = v3_req

[ req_distinguished_name ]
CN = adguard.home

[ v3_req ]
subjectAltName = @alt_names
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[ alt_names ]
DNS.1 = adguard.home
IP.1 = 192.168.77.1' | sudo tee /home/admin/tools/CA/SSL/openssl-adguardhome.cnf > /dev/null
```

Now, generate the *Private Key* for *adguard.home*:
```
openssl genrsa -out adguard.home.key 2048
```

Create a *Certificate Signing Request (CSR)*:
```
openssl req -new -key adguard.home.key -out adguard.home.csr -config openssl-adguardhome.cnf
```

Sign the *Certificate Signing Request (CSR)* with the *Local Certificate Authority (CA)*:
```
openssl x509 -req -in adguard.home.csr -CA ../term7-CA.pem -CAkey ../term7-CA.key -CAcreateserial -out adguard.home.crt -days 90 -extensions v3_req -extfile openssl-adguardhome.cnf
```

Create the Full-Chain Certificate:
```
cat adguard.home.crt ../term7-CA.pem > adguard.home-fullchain.crt
```

#### 4. Trust the Certificate Authority on Your Raspberry Pi

Copy the CA certificate to the system's trusted certificate directory:
```
sudo cp ~/tools/CA/term7-CA.pem /usr/local/share/ca-certificates/term7-CA.crt
```

Update the system's certificate store:
```
sudo update-ca-certificates
```

#### 5. Transfer the Certificate to Your Mac

Since we have enforced strict user access control, root login is not allowed. To transfer the certificate to our Mac, we first copy it to our standard user account:
```
sudo cp ~/tools/CA/term7-CA.pem /home/term7/
```

Now, on your Mac, open a new Terminal window and run the following command to securely copy the certificate to your Downloads folder. Once the transfer is complete, we immediately delete it from the Raspberry Pi standard user account:
```
scp -P 8519 term7@192.168.77.1:term7-CA.pem ~/Downloads/ && ssh -p 8519 term7@192.168.77.1 "rm term7-CA.pem"
```

#### 6. Install and Trust the Certificate on macOS

Run the following command to add the certificate to the macOS System Keychain and mark it as trusted for all users:
```
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/Downloads/term7-CA.pem
```

This ensures the certificate is recognized as a Root Certificate Authority, allowing you to access https://adguard.home without encountering security warnings.

If you ever want to delete this certificate, run:
```
sudo security delete-certificate -c "term7-CA" /Library/Keychains/System.keychain
```

#### 7. Automatically Renew Certificate on your Raspberry Pi


Create renew script (it will only run if certificate expires within 30 days):

```
sudo tee /home/admin/script/SSL/renew-cert.sh > /dev/null << EOF
#!/bin/bash
set -euo pipefail

# Where to store the log (overwrite on each run)
LOG_FILE="/home/admin/script/SSL/renewal.log"
: > "$LOG_FILE"  # truncate at start

# ----- Timestamp every log line -----
if command -v ts >/dev/null 2>&1; then
  exec > >(ts "[%Y-%m-%d %H:%M:%S]" >> "$LOG_FILE") 2>&1
else
  exec > >(awk '{ print strftime("[%Y-%m-%d %H:%M:%S]"), $0; fflush(); }' >> "$LOG_FILE") 2>&1
fi

# ----- Config -----
CA_DIR="/home/admin/tools/CA"
SSL_DIR="$CA_DIR/SSL"
CA_CERT="$CA_DIR/term7-CA.pem"
CA_KEY="$CA_DIR/term7-CA.key"
CA_SERIAL="$CA_DIR/term7-CA.srl"
DAYS=825
DOMAINS=("adguard.home")
RESTART_SERVICES=("nginx" "AdGuardHome")

# --- Renewal loop ---
for DOMAIN in "${DOMAINS[@]}"; do
  CNF_FILE="$SSL_DIR/openssl-${DOMAIN//./}.cnf"
  CRT_FILE="$SSL_DIR/$DOMAIN.crt"
  KEY_FILE="$SSL_DIR/$DOMAIN.key"
  CSR_FILE="$SSL_DIR/$DOMAIN.csr"
  FULLCHAIN="$SSL_DIR/$DOMAIN-fullchain.crt"

  if [ ! -f "$CRT_FILE" ]; then
    DAYS_LEFT=0
  else
    ENDLINE="$(openssl x509 -enddate -noout -in "$CRT_FILE" 2>/dev/null || true)"
    if [[ "$ENDLINE" =~ ^notAfter= ]]; then
      EXPIRY_RAW="${ENDLINE#notAfter=}"
      EXPIRY_EPOCH=$(date -d "$EXPIRY_RAW" +%s)
      NOW_EPOCH=$(date +%s)
      SECS_LEFT=$(( EXPIRY_EPOCH - NOW_EPOCH ))
      DAYS_LEFT=$(( SECS_LEFT > 0 ? SECS_LEFT / 86400 : 0 ))
    else
      DAYS_LEFT=0
    fi
  fi

  if [ "$DAYS_LEFT" -gt 30 ]; then
    echo "$DOMAIN: certificate expiring in $DAYS_LEFT days — not renewing."
    continue
  else
    echo "$DOMAIN: certificate expiring in $DAYS_LEFT days — renewing..."
  fi

  openssl req -new -key "$KEY_FILE" -out "$CSR_FILE" -config "$CNF_FILE"
  openssl x509 -req \
    -in "$CSR_FILE" \
    -CA "$CA_CERT" -CAkey "$CA_KEY" \
    -CAserial "$CA_SERIAL" -CAcreateserial \
    -out "$CRT_FILE" \
    -days "$DAYS" \
    -extensions v3_req -extfile "$CNF_FILE"

  cat "$CRT_FILE" "$CA_CERT" > "$FULLCHAIN"

  NEW_END="$(openssl x509 -in "$CRT_FILE" -noout -enddate | sed 's/^notAfter=//')"
  echo "$DOMAIN: new certificate expires on $NEW_END"
done

# --- Restart services ---
for svc in "${RESTART_SERVICES[@]}"; do
  if systemctl is-enabled "$svc" >/dev/null 2>&1 || systemctl is-active "$svc" >/dev/null 2>&1; then
    sudo systemctl restart "$svc"
  fi
done
EOF
```

Make the script executable:
```
sudo chmod +x /home/admin/script/SSL/renew-cert.sh
```

Finally create a cronjob that runs the script at every reboot:
```
( sudo crontab -l 2>/dev/null | grep -v 'renew-cert.sh' ; \
  echo '@reboot /home/admin/script/SSL/renew-cert.sh' \
) | sudo crontab -
```

* * *

## 17 SETUP NGINX REVERSE PROXY

**⚠ IMPORTANT: Completing chapters 13 - 19 step by step in the correct order is crucial! Any misconfiguration could cause DNS issues, potentially leading to loss of internet connectivity for your Raspberry Pi and its connected clients — or even lock you out completely. Even small mistakes or skipped steps may result in certain aspects of the setup not working as expected. Proceed carefully and follow each step precisely.**

In this section, we will configure *NGINX* as a reverse proxy for *AdGuardHome's* web interface. This will allow us to serve the interface securely while enabling additional customization options.

#### 1. Install NGINX:

First, install *NGINX*, a modern and lightweight web server:
```
sudo apt install -y nginx
```

By default, *NGINX* is configured to listen on IPv6, but since we have previously disabled IPv6 on this system, the nginx.service will fail to start. To prevent this, we need to modify the default configuration file and disable IPv6 support:<br>
```
sudo sed -i 's/^\(\s*listen \[::\]:80 default_server;\)/# \1/' /etc/nginx/sites-available/default
```

#### 2. Configure NGINX as a reverse proxy for AdGuardHome:

Next, we configure *NGINX* to serve as a reverse proxy for the *AdGuardHome* web interface and to forward DNS-over-HTTPS (DoH) requests between connected clients and *AdGuardHome*.<br>
Run the following command to create the configuration:

```
echo 'server {
    listen 443 ssl http2;

    server_name adguard.home;

    ssl_certificate /home/admin/tools/CA/SSL/adguard.home.crt;
    ssl_certificate_key /home/admin/tools/CA/SSL/adguard.home.key;

    # Proxy AdGuardHome Web Interface
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Proxy DNS-over-HTTPS (DoH) Requests to AdGuardHome
    location /dns-query {
        proxy_pass https://127.0.0.1:7443/dns-query$is_args$args;
        proxy_ssl_server_name on;
        proxy_ssl_verify off;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # Preserve query strings
        proxy_redirect off;
    }
}

server {
    listen 80;
    server_name adguard.home;

    # Redirect HTTP to HTTPS
    return 301 https://$host$request_uri;
}' | sudo tee /etc/nginx/sites-available/nginx-adguard > /dev/null
```

#### 3. Enable the NGINX Configuration:

To activate the newly created NGINX configuration:
```
sudo ln -s /etc/nginx/sites-available/nginx-adguard /etc/nginx/sites-enabled/
```

#### 4. Validate and Restart NGINX:

Before restarting NGINX, test the configuration for syntax errors:
```
sudo nginx -t
```

If the test is successful, restart *NGINX*:
```
sudo systemctl restart nginx
```

#### 5. Ensure Local Hostname Resolution, both on your Raspberry Pi and on your Mac:

To allow local resolution of adguard.home, update the /etc/hosts file of your Raspberry Pi:
```
sudo sed -i '/127.0.0.1/s/$/\n192.168.77.1    adguard.home/' /etc/hosts
```

On your Mac:
```
grep -q 'adguard.home' /etc/hosts || echo '192.168.77.1    adguard.home' | sudo tee -a /etc/hosts > /dev/null
```

#### 6. Add adguard.home also to your Mac's host file:

To allow local resolution of adguard.home, update the /etc/hosts file:
```
sudo sed -i '/127.0.0.1/s/$/\n192.168.77.1    adguard.home/' /etc/hosts
```

**⚠️ IMPORTANT: At this stage, the necessary services are configured, but the firewall is not yet set up. Without proper firewall rules, routing will not function as expected, and your setup may not work correctly. The next section will guide you through setting up the firewall. Complete this section first before rebooting your Raspberry Pi.**

* * *

## 18 FIREWALL

**⚠ IMPORTANT: Completing chapters 13 - 19 step by step in the correct order is crucial! Any misconfiguration could cause DNS issues, potentially leading to loss of internet connectivity for your Raspberry Pi and its connected clients — or even lock you out completely. Even small mistakes or skipped steps may result in certain aspects of the setup not working as expected. Proceed carefully and follow each step precisely.**

In this section, we will configure *nftables*, a modern firewall application that is installed by default on your Raspberry Pi. , a modern firewall solution that comes pre-installed on your Raspberry Pi. Our firewall setup is designed to maximize security, prevent unauthorized access, and ensure only essential services function correctly while protecting connected devices.

To avoid manual configuration errors, download our pre-configured firewall setup from the repository:

```
sudo curl -L -o /etc/nftables.conf "https://codeberg.org/term7/Going-Dark/raw/branch/main/Pi%20Configuration%20Files/nftables/nftables.conf"
```

Our firewall includes multiple security mechanisms to block attacks, enforce network segmentation, and prevent unauthorized access:

#### 1. Protection Against Unauthorized Access

- Blocks all incoming traffic by default: Only explicitly allowed traffic is permitted.
- Restricts SSH access: Only allows SSH (port 6666) from the private network (*usb0* and *wlan0*) and limits SSH connection attempts to 3 per minute to prevent brute-force attacks.

#### 2. Defense Against Network Scanning & DDoS Attacks
- Mitigates SYN Flood Attacks: The firewall limits new TCP connections to 5 per second with a burst of 10 packets.
- Drops malicious packets: NULL packets (often used in stealth scans), XMAS packets (used for port scanning) and invalid TCP flag combinations to prevent malformed packet attacks.

#### 3. Restriction of Internet-Facing Access (Minimal Attack Surface)
- Blocks unnecessary inbound traffic from the internet.
- Allows limited ICMP (ping) requests – Maximum 3 per second.
- Drops all other external traffic unless explicitly allowed.

#### 4. Control Over Internal Network Traffic
- DNS (AdGuardHome) on port 5357 (UDP/TCP) → Ensures DNS queries are filtered and logged.
- DHCP (ports 67/68) → Required for IP address assignment.
- NTP (port 123) → Ensures accurate time synchronization.
- HTTPS (port 443) → Enables secure web access.
- Any unapproved connection attempts are rejected with a TCP reset.

#### 5. Enforced DNS Filtering
- Redirects all client DNS queries to *AdGuardHome* (port 5357) and prevents users from bypassing *AdGuardHome* → Enforces DNS filtering so all queries are logged and filtered.

#### 6. Isolation of Devices (Prevents Unauthorized Lateral Movement)
- Blocks direct traffic between *usb0* (Ethernet Gadget) and *wlan0* (Wi-Fi Hotspot). This prevents clients from communicating across networks, reducing security risks.

#### 7. Secure Internet Access via Network Address Translation (NAT)
- Masquerades all outgoing traffic from the private network (*usb0*, *wlan0*) to the internet → Hides internal IP addresses and prevents direct exposure of connected devices.

#### 8. Disabling IPv6 (Prevents IPv6 Leaks & Attacks)
- Drops all IPv6 traffic to prevent potential IPv6-based attacks or leaks. 
- Ensures all traffic is routed through IPv4, which is explicitly controlled by the firewall.

**⚠️ CRITICAL: Configure the Firewall for Your Wi-Fi Adapter: If you use a different Wi-Fi adapter than the [ALFA AWUS036ACM](https://www.alfa.com.tw/products/awus036acm_1?_pos=1&_ss=r&variant=40320133464136), the firewall will break! Run the following commands to update the firewall configuration with your adapter’s predictable interface name:**<br>

```
WIFI='PREDICTABLE-INTERFACE-NAME'
```
```
sudo sed -i "s/\bwlx00c0caae6319\b/$WIFI/" /etc/nftables.conf
```
**⚠ Replace PREDICTABLE-INTERFACE-NAME with your actual Wi-Fi adapter name. For guidance, refer to [03 - PREREQUISITES](#03-prerequisites) and [11 SETUP WIRELESS HOTSPOT](#11-setup-wireless-hotspot).**

Enable *nftables* so the firewall rules persist across reboots:
```
sudo systemctl enable nftables
```

**⚠️ IMPORTANT: Prevent NetworkManager from Overwriting Firewall Rules!**<br>
By default, NetworkManager can interfere with firewall settings. Our setup is too complex to allow this:

```
sudo sed -i '/^dhcp=dnsmasq$/a firewall-backend=none' /etc/NetworkManager/NetworkManager.conf
```

Reboot to apply all changes:
```
sudo reboot now
```

#### 9. Install fail2ban

*Fail2ban* monitors log files for suspicious activity (such as failed SSH login attempts) and responds by blocking the offending IPs using firewall rules. In our setup, SSH is configured to listen on port 6666. Since our *nftables* configuration uses the inet `global` table, we need to create a dedicated *Fail2ban Set* and *Chain* inside that table.

```
sudo sed -i '/table inet global {/a\
\
    # Create the Fail2ban set\
    set f2b-sshd {\
        type ipv4_addr\
        flags timeout\
    }\
\
    # Create the Fail2ban chain that drops packets from IPs in the set\
    chain f2b-sshd {\
        ip saddr @f2b-sshd drop\
    }' /etc/nftables.conf
```

Next, hook the new `f2b-sshd` chain into your existing `inbound` chain:

```
sudo sed -i '/^[[:space:]]*chain inbound {$/{
  n
  s/\(policy drop;\)/\1\
\
        # Check for banned IPs via Fail2ban\
        jump f2b-sshd/
}' /etc/nftables.conf
```

Install *fail2ban*:
```
sudo apt install -y fail2ban
```

Create a custom *Fail2ban Action* for *nftables*:

```
echo '[Definition]

actionstart =
actionstop =

# When banning an IP, add it to the set with the given bantime.
actionban = /usr/sbin/nft add element inet global f2b-sshd \{ <ip> timeout <bantime>s \}

# When unbanning an IP, remove it from the set.
actionunban = /usr/sbin/nft delete element inet global f2b-sshd \{ <ip> \}' | sudo tee /etc/fail2ban/action.d/nftables-ssh.conf > /dev/null
```

Next, we need to configure *fail2ban* to monitor SSH on port 6666 using *systemd journal*, which is our Raspberry Pi's default logging mechanism:

```
echo '[sshd]
enabled  = true
port     = 6666
filter   = sshd
backend  = systemd
findtime = 600
maxretry = 2
bantime  = 165600
ignoreip = 192.168.77.77
action   = nftables-ssh[name=sshd, port=6666, protocol=tcp]' | sudo tee /etc/fail2ban/jail.local > /dev/null
```

This configuration monitors SSH on port 6666, and if an IP fails to authenticate twice, it will be banned for 46 hours by adding a rule via *nftables* to drop its packets. The only IP exempt from this policy is `192.168.77.77`, which belongs to our WORKSTATION connected via the `usb0` interface.

Reload your firewall:
```
sudo nft -f /etc/nftables.conf
```

Restart *fail2ban*:
```
sudo systemctl restart fail2ban
```

Check Fail2ban Status:
```
sudo fail2ban-client status sshd
```

Use the following command to list the banned IPs in the *fail2ban* set:
```
sudo nft list set inet global f2b-sshd
```


* * *

## 19 CONFIGURE ADGUARDHOME

**⚠ IMPORTANT: Completing chapters 13 - 19 step by step in the correct order is crucial! Any misconfiguration could cause DNS issues, potentially leading to loss of internet connectivity for your Raspberry Pi and its connected clients — or even lock you out completely. Even small mistakes or skipped steps may result in certain aspects of the setup not working as expected. Proceed carefully and follow each step precisely.**

This repository provides a pre-configured *AdGuardHome* setup, which we highly recommend using. It is specifically tailored to prevent common conflicts, such as port overlaps with *NGINX* for HTTPS. Additionally, it ensures seamless integration with our setup by:

- Avoiding port overlaps with *NGINX* for HTTPS.
- Assigning correct DNS ports for compatibility.
- Pre-configuring the necessary SSL certificate paths from the previous section.
- Using *Unbound* as the sole upstream resolver for enhanced privacy and security.

Additionally, this configuration includes:

- Predefined fallback DNS servers for encrypted queries (DNS-over-HTTPS), we think they are likely trustworthy:
    - `https://doh.mullvad.net/dns-query`
    - `https://dns.digitale-gesellschaft.ch/dns-query`
    - `https://anycast.uncensoreddns.org/dns-query`
    - `https://unicast.uncensoreddns.org/dns-query`
    - `https://doh.libredns.gr/dns-query`
    - `https://odvr.nic.cz/dns-query`
    - `https://doh.ffmuc.net/dns-query`
- Optimized caching settings for improved performance.
- Comprehensive logging and debugging options.
- Multiple DNS filters to block ads, trackers, and malicious domains.

By using this setup, you can avoid potential issues and ensure a smooth, hassle-free deployment. Unless you know exactly what you are doing, we recommend you don't change our *Encryption Settings* and don't use *AdGuardHome's* built-in DHCP server. We have set up *NetworkManager* and *Dnsmasq* to handle DHCP.

#### 1. Stop AdGuardHome:

Before applying the new configuration, stop the AdGuardHome service:
```
sudo systemctl stop AdGuardHome
```

#### 2. Download the Configuration File:

Fetch the pre-configured setup from the repository:
```
sudo curl -L -o /home/admin/build/AdGuardHome/AdGuardHome.yaml "https://codeberg.org/term7/Going-Dark/raw/branch/main/Pi%20Configuration%20Files/adguard-home/AdGuardHome.yaml"
```

Restrict file permissions to enhance security:
```
sudo chmod 600 ~/build/AdGuardHome/AdGuardHome.yaml
```
#### 3. Change the Default Password:

Since this is a public repository, the default password is set to *"default"*. You must change it!

To generate a bcrypt-hashed password, install the `whois` package:
```
sudo apt install -y whois
```

Run the following commands to replace the default password:
```
PASSWORD='YOUR-NEW-PASSWORD'
```

```
sudo sed -i "s/^    password: default/    password: \"$(mkpasswd -m bcrypt "$PASSWORD")\"/" ~/build/AdGuardHome/AdGuardHome.yaml

```
**⚠ Replace YOUR-NEW-PASSWORD with a strong password of your choice. Consider using a password manager to generate a secure password.**

#### 4. Restart AdGuardHome:

Once the password has been updated, restart the service:
```
sudo systemctl start AdGuardHome
```

#### 5. Log into AdGuardHome's Web Interface:

Now, test your setup:

1. Disable Wi-Fi on your Mac.
2. Open your browser and navigate to [https://adguard.home](https://adguard.home).
3. Log in as *term7* with YOUR-NEW-PASSWORD.

**CONGRATULATIONS**

Your *AdGuardHome* installation is now fully configured and running!

#### 6. Test DNSSEC Validation:

To test if DNSSEC validation is working, visit this website:<br>
[https://wander.science/projects/dns/dnssec-resolver-test/](https://wander.science/projects/dns/dnssec-resolver-test/)

* * *

## 20 DNS BLOCKLISTS

In this section, we’ll briefly cover DNS blocklists and allowlists — two essential tools for controlling DNS traffic in *AdGuardHome*.

#### Disallowed Domains

*AdGuardHome*  supports a list of Disallowed Domains, which are domains that will be explicitly blocked. By default, only `version.bind` is included, but we’ve expanded this list to cover domains commonly used for DNS diagnostics, debugging, or network testing—not regular web browsing or app usage. Blocking these domains helps to enhance privacy by preventing IP and server info leakage, reduce unnecessary DNS queries and avoids exposing internal DNS details:

- `version.bind`
- `id.server`
- `hostname.bind`
- `devices.resolving.planetlab.google.com`
- `whoami.ultradns.net`
- `whoami.akamai.net`
- `debug.opendns.com`
- `resolver.dnscrypt.info`
- `edns-client-subnet.test-ipv6.com`
- `test.dnssec-or-not.net`
- `porttest.dns-oarc.net`

#### Custom Filtering Rules

n this section, we explicitly allow the domain `check.torproject.org`:

```
! Allow Tor Check
!
@@||torproject.org^$important
```

This domain is used later in our [TOR TRANSPARENT PROXY](#22-tor-transparent-proxy) setup to verify Tor routing. Since it is blocked by one of our pre-configured blocklists, we whitelist it here to ensure it functions correctly. Feel free to add your own custom allow or block rules in this section, depending on your specific use case.

#### Pre-configured Blocklists

Our default blocklists are sourced from this excellent GitHub repository maintained by Gerd Hagezi:
[https://github.com/hagezi/dns-blocklists](https://github.com/hagezi/dns-blocklists)

The following lists are enabled by default in our configuration:

1.<br>
**Hagezi: Threat Intelligence Feeds**<br>
*Description: Increases security significantly! Blocks Malware, Cryptojacking, Spam, Scam and Phishing.*<br>
Number of entries: 962584 / 21 Mar 2025

[https://codeberg.org/hagezi/mirror2/raw/branch/main/dns-blocklists/adblock/tif.txt](https://codeberg.org/hagezi/mirror2/raw/branch/main/dns-blocklists/adblock/tif.txt)

2.<br>
**Hagezi: Multi ULTIMATE**<br>
*Description: Ultimate Sweeper - Strictly cleans the Internet and protects your privacy! Blocks Ads, Affiliate, Tracking, Metrics, Telemetry, Phishing, Malware, Scam, Free Hoster, Fake, Cryptojacking and other "Crap".*<br>
Number of entries: 334037 / 21 Mar 2025

[https://codeberg.org/hagezi/mirror2/raw/branch/main/dns-blocklists/adblock/ultimate.txt](https://codeberg.org/hagezi/mirror2/raw/branch/main/dns-blocklists/adblock/ultimate.txt)

3.<br>
Hagezi: Gambling DNS Blocklist<br>
Description: Blocks gambling content.<br>
Number of entries: 704324 / 21 Mar 2025

[https://codeberg.org/hagezi/mirror2/raw/branch/main/dns-blocklists/adblock/gambling.txt](https://codeberg.org/hagezi/mirror2/raw/branch/main/dns-blocklists/adblock/gambling.txt)

4.<br>
Hagezi: Fake DNS Blocklist<br>
Description: Protects against internet scams, traps & fakes! Blocks fake stores, -streaming, rip-offs, cost traps and co..<br>
Number of entries: 10744 / 20 Mar 2025

[https://codeberg.org/hagezi/mirror2/raw/branch/main/dns-blocklists/adblock/fake.txt](https://codeberg.org/hagezi/mirror2/raw/branch/main/dns-blocklists/adblock/fake.txt)

5.<br>
Hagezi: Pop-Up Ads DNS Blocklist<br>
Description: Blocks annoying and malicious pop-up ads.<br>
Number of entries: 100339 / 20 Mar 2025

[https://codeberg.org/hagezi/mirror2/raw/branch/main/dns-blocklists/adblock/popupads.txt](https://codeberg.org/hagezi/mirror2/raw/branch/main/dns-blocklists/adblock/popupads.txt)

6.<br>
Hagezi: DoH/VPN/TOR/Proxy Bypass<br>
Description: Prevent methods to bypass your DNS, blocks encrypted DNS, VPN, TOR, Proxies.<br>
Number of entries: 3888 / 20 Mar 2025

[https://codeberg.org/hagezi/mirror2/raw/branch/main/dns-blocklists/adblock/doh-vpn-proxy-bypass.txt](https://codeberg.org/hagezi/mirror2/raw/branch/main/dns-blocklists/adblock/doh-vpn-proxy-bypass.txt)

7.<br>
Hagezi: Amazon Tracker DNS Blocklist<br>
Description: Blocks Amazon native broadband tracker that track your activity.<br>
Number of entries: 334 / 08 Mar 2025

[https://codeberg.org/hagezi/mirror2/raw/branch/main/dns-blocklists/adblock/native.amazon.txt](https://codeberg.org/hagezi/mirror2/raw/branch/main/dns-blocklists/adblock/native.amazon.txt)

8.<br>
Hagezi: Windows/Office Tracker DNS Blocklist<br>
Description: Blocks Windows/Office native broadband tracker that track your activity.<br>
Number of entries: 357 / 14 Mar 2025

[https://codeberg.org/hagezi/mirror2/raw/branch/main/dns-blocklists/adblock/native.winoffice.txt](https://codeberg.org/hagezi/mirror2/raw/branch/main/dns-blocklists/adblock/native.winoffice.txt)

9.<br>
Hagezi: Apple Tracker DNS Blocklist<br>
Description: Blocks Apple native broadband tracker that track your activity.<br>
Number of entries: 93 / 22 Feb 2025

[https://codeberg.org/hagezi/mirror2/raw/branch/main/dns-blocklists/adblock/native.apple.txt](https://codeberg.org/hagezi/mirror2/raw/branch/main/dns-blocklists/adblock/native.apple.txt)



#### Optional Blocklist

This blocklist is disabled by default and intended for advanced users who want to fully restrict Apple’s online services. It is an aggressive list that blocks all known Apple domains, along with many third-party services used by Apple infrastructure.

**⚠️ Warning: Enabling this list will completely break most Apple services, including (but not limited to): iCloud, Apple TV+, Apple Music, Apple Arcade, Apple Maps, Apple News+, Apple Pay, App Store, iMessage, FaceTime, FindMy, etc.**

Despite the broad blocking, we actively maintain a minimal allowlist of essential domains required for critical macOS software and security updates.


10.<br>
**Term7: Ultimate Apple Blocklist**<br>
Description: Ultimate Apple Blocklist - WARNING: Breaks Apple Services<br>
Comment: Allows critical Software and Security Updates<br>
Number of entries: 37 / 21 Mar 2025

[https://codeberg.org/term7/Break-Apple-Blocklist/raw/branch/main/Break-Apple-Blocklist.txt](https://codeberg.org/term7/Break-Apple-Blocklist/raw/branch/main/Break-Apple-Blocklist.txt)

* * *

## 21 WIREGUARD VPN

In this section, we’ll configure a Raspberry Pi as a *WireGuard client* that can be activated whenever you need it. This setup works seamlessly with *AdGuardHome*, which will continue to filter ads and block malicious domains before DNS queries are forwarded through the *WireGuard VPN* tunnel.

In our personal setup, we’ve installed a *WireGuard* server on our home router (running OpenWRT). When we travel, whether staying in a hotel, at an airport, or working from a café abroad, our Raspberry Pi tunnels all network traffic through a secure, encrypted *WireGuard* connection back to our home router.<br>
This means our internet traffic is shielded from local networks and snoopers. We can securely access our home network and services from anywhere in the world and devices connected to the Pi will appear to access the internet from our home IP address.

This is how a connected device would connect to the internet through our *WireGuard VPN*:

```
+---------------------+       +-------------------------------+                 +-----------------------+
|                     |       |          RASPBERRY PI         |                 |                       |
|                     |       |                               |                 |                       |
|   Laptop / Phone    |  TCP  |        WIREGUARD CLIENT       |  encrypted TCP  |   WIREGUARD SERVER    |
|       NO VPN        | <---> |           10.13.0.1           | <-------------> |    --> Home Router    | 
|                     |  DNS  |                               |  encrypted DNS  |                       |
|                     |       |            Firewall           |                 |                       |
+---------------------+       +-------------------------------+                 +-----------------------+
                                              ^                                             ^
                                              |                                             |
                                          DNS |                                         TCP | DNS
                                              |                                             |
                                              v                                             v
                              +-------------------------------+                      +--------------+
                              |                               |                      |              |
                              |    AdGuardHome --> Unbound    |                      |   INTERNET   |
                              |   DNS Filtering + Forwarding  |                      |              |
                              |                               |                      +--------------+
                              +-------------------------------+
```

**Note: A full walkthrough of setting up a WireGuard server on your home router is beyond the scope of this tutorial.**

For this tutorial, we’ll assume:

- You already have access to a *WireGuard Server*.
- You have a *WireGuard Client Configuration File* ready to import.

This server can be:

- A self-hosted *WireGuard* instance running on your home router
- A self-hosted *WireGuard* instance on a *Virtual Private Server* (VPS) 
- Or a trusted VPN provider that supports *WireGuard*

If you don’t run your own server, both [Mullvad](https://mullvad.net/en) and [ProtonVPN](https://protonvpn.com/) are strong privacy-focused options. They offer support for *WireGuard* and allow you to download config files that work without their apps.

1. [ProtonVPN](https://protonvpn.com/) → Swiss-based, supports WireGuard and allows client profile generation (paid subscription required).
2. [Mullvad](https://mullvad.net/en) → Swedish-based, offers app-free WireGuard configuration downloads with no email required.

**Note: Both claim strict no-logs policies, but like all VPN providers, this trust cannot be independently verified. If you’re using a commercial VPN, you ultimately have to trust the provider.**

### 1. Copy your WireGuard Configuration to your Raspberry Pi:

In this tutorial, we’ll use a *WireGuard* configuration file named `term7.wireguard.conf`. Replace this filename with your own wherever it appears.

Since we have disabled root login, we’ll need to copy the configuration file to your non-root user account on the Raspberry Pi. On your Mac, open a terminal and run:

```
scp -P 6666 ~/Desktop/wireguard-export/term7.wireguard.conf term7@192.168.77.1:/home/term7/
```

Now, log into your Raspberry Pi using your admin user account and prepare the directory to store the config file:
```
[ -d ~/tools ] || mkdir ~/tools && [ -d ~/tools/wireguard-export ] || mkdir ~/tools/wireguard-export
```

Move the configuration file to its new location:
```
sudo mv /home/term7/term7.wireguard.conf ~/tools/wireguard-export/term7.wireguard.conf
```

#### 2. Import the WireGuard Configuration with NetworkManager:

NetworkManager has built-in support for *WireGuard*. We use it to import our configuration::

```
sudo nmcli connection import type wireguard file ~/tools/wireguard-export/term7.wireguard.conf
```

Once imported, it's a good idea to bring the connection down immediately (in case it auto-connected):
```
sudo nmcli con down term7.wireguard
```

Disable auto-connect for this VPN profile (we’ll activate it manually):
```
sudo nmcli con modify term7.wireguard connection.autoconnect no
```

#### 3. Setup WireGuard Firewall:

When *WireGuard* is active, we want to adjust our firewall so that traffic is routed through the VPN (`term7.wireguard`) instead of the default Ethernet or Wi-Fi interface.

First, create the necessary directory structure for firewall configs:
```
[ -d ~/script ] || mkdir ~/script && [ -d ~/script/nftables ] || mkdir ~/script/nftables
```

Make a backup of the default *nftables* configuration:
```
sudo cp /etc/nftables.conf ~/script/nftables/nftables.conf
```

Copy the default rules as a base for the WireGuard-specific configuration:
```
sudo cp ~/script/nftables/nftables.conf ~/script/nftables/wireguard.conf
```

Update the interface definition in the new config to route traffic via the WireGuard interface:
```
sudo sed -i '/DEV_WORLD = {/c\define DEV_WORLD = { term7.wireguard }' ~/script/nftables/wireguard.conf

```

#### 4. Dynamically Apply Firewall Rules Using a Dispatcher Script:

We’ll use a *NetworkManager* dispatcher script to automatically switch firewall and default *Unbound* DNS configurations when *WireGuard* connects or disconnects. When the VPN is active, *Unbound* switches into a 'VPN mode': instead of performing recursive DNS resolution using root servers, it now forwards all DNS queries through the encrypted *WireGuard* tunnel. These forwarded queries are then resolved on the other end of the tunnel. In our case, that’s our home router, which is configured to use DNS-over-HTTPS (DoH) for secure and private DNS resolution. Despite switching to a forwarding setup, *Unbound* will still enforce DNSSEC validation, ensuring that DNS responses are authenticated and have not been tampered with. Additionally, the script restarts *fail2ban* to reinstate previously banned IPs.

Create the script:

```
sudo tee /etc/NetworkManager/dispatcher.d/wireguard-handler > /dev/null << 'EOF'
#!/bin/bash

# Define Interfaces
WG_INTERFACE="term7.wireguard"

# Define Config Files
WG_RULES="/home/admin/script/nftables/wireguard.conf"
DEFAULT_RULES="/etc/nftables.conf"
UNBOUND_CONFIG="/etc/unbound/unbound.conf.d/local-zones.conf"

# Define WireGuard DNS Config
WG_DNS_CONFIG="# Upstream DNS via WireGuard\nforward-zone:\n    name: \".\"\n    forward-addr: 10.13.0.1"

case "$1" in
    $WG_INTERFACE)
        case "$2" in
            up)
                # Apply WireGuard firewall rules
                /usr/sbin/nft -f "$WG_RULES"

                # Append WireGuard DNS to Unbound if not already present
                if ! grep -Fxq "$WG_DNS_CONFIG" "$UNBOUND_CONFIG"; then
                    echo -e "\n$WG_DNS_CONFIG" | sudo tee -a "$UNBOUND_CONFIG" > /dev/null
                fi

                sudo systemctl restart unbound
                sudo systemctl restart fail2ban
                ;;
            down)
                # Restore default nftables rules
                /usr/sbin/nft -f "$DEFAULT_RULES"

                # Remove WireGuard DNS Config
                sed -i '/fallback-enabled: yes/,$d' "$UNBOUND_CONFIG"
                echo "        fallback-enabled: yes" | sudo tee -a "$UNBOUND_CONFIG" > /dev/null

                sudo systemctl restart unbound
                sudo systemctl restart fail2ban
                ;;
        esac
        ;;
esac
EOF
```

Make script executable:
```
sudo chmod +x /etc/NetworkManager/dispatcher.d/wireguard-handler
```

#### 5. Start/Stop the WireGuard Connection:

To start *WireGuard VPN*:
```
sudo nmcli con up term7.wireguard
```

To stop *WireGuard VPN*:
```
sudo nmcli con down term7.wireguard
```

#### 6. Test DNSSEC Validation & DNS Leaks:

To verify that DNSSEC validation is still functioning correctly, visit:<br>
[https://wander.science/projects/dns/dnssec-resolver-test/](https://wander.science/projects/dns/dnssec-resolver-test/)

To check for DNS leaks, use:<br>
[https://dnsleaktest.com](https://dnsleaktest.com)

The only visible IP address should be that of your VPN provider or the DNS server configured on your home router or VPS.
If you see your local ISP's DNS servers, the VPN tunnel or *Unbound* forwarding may not be working as intended.

* * *

## 22 TOR TRANSPARENT PROXY

Finally, we’ll install *Tor* and configure our Raspberry Pi to function as a *Tor Transparent Proxy*. This setup can be manually activated or deactivated as needed. When enabled, all traffic from connected devices will continue to be filtered by *AdGuardHome* before being securely routed through the *Tor network*.

**⚠️ WARNING: A *Tor Transparent Proxy* is not the recommended method for using the *Tor network*. If your goal is simply to browse the internet anonymously, we strongly recommend using the *[Tor Browser](https://www.torproject.org/download/)* instead! The *Tor Browser* is specifically engineered for privacy and anonymity. It standardizes browser behavior to minimize fingerprinting and includes built-in protections against tracking, script-based surveillance, and DNS leaks. In contrast, a transparent proxy only redirects network traffic through the *Tor network*. It does not prevent applications or browsers from leaking identifying information. Using a regular browser over a *Tor Transparent Proxy* will almost certainly still expose a unique fingerprint, undermining the core benefits of using *Tor* in the first place. That said, you can combine a *Tor Transparent Proxy* (to anonymize all system traffic) with the *Tor Browser* (for safe, anonymous browsing) to benefit from both system-wide routing and hardened browser protections.**

That said, a well-configured *Tor Transparent Proxy* can be a powerful companion for anonymizing general traffic, securing non-browser applications, and creating a privacy-focused environment. When properly set up with strict firewall rules, DNS leak protection, and controlled network access, it allows you to create a reliable, plug-and-play “privacy hotspot” — ideal for travel, shared networks, or securing headless devices. That’s exactly what we’ll achieve in this tutorial.

This is how a connected device would connect to the internet via our *Tor Transparent Proxy*:

```
+---------------------+       +-------------------------------+                 +----------------------+
|                     |       |          RASPBERRY PI         |                 |                      |
|                     |       |                               |                 |    TOR ENTRY NODE    |
|   Laptop / Phone    |  TCP  |     TOR TRANSPARENT PROXY     |  encrypted TCP  |                      |
| (No Tor Installed)  | <---> |  10.192.0.1 / TransPort 9040  | <-------------> |  KNOWS your real IP  |
|                     |  DNS  |                               |                 | NOT your destination |
|                     |       |            Firewall           |                 |                      |
+---------------------+       +-------------------------------+                 +----------------------+
                                       ^                                            ^       ^
                                       |                                            |       |
                                   DNS |                                            |       |
                                       |                                            |       |
                                       V                                            |       |
                    +------------------------------+             encrypted DNS      |       |
                    |                              | <------------------------------/       |
                    |   AdGuardHome --> Unbound    |                                        | TCP / Onion Encryption 
                    |  DNS Filtering + Forwarding  |                                        |
                    |                              |                 DNS / Onion Encryption |
                    |  10.192.0.1 / DNS Port 9053  |                                        |
                    |     TOR TRANSPARENT PROXY    |                                        |
                    |                              |                                        v
                    +------------------------------+                            +----------------------+
                                                                                |                      |
                                                                                |    TOR RELAY NODE    |
                                                                                |                      |
                                                                                |     NEITHER knows    | 
                                                                                |        your IP       | 
                                                                                | NOR your destination |
                                                                                |                      |
                                                                                +----------------------+
                                                                                            ^
                                                                                            |
                                                                                            | TCP / Onion Encryption
                                                                                            |
                                                                     DNS / Onion Encryption |
                                                                                            |
                                                                                            v
                                                                                +----------------------+
                                                                                |                      |
                                                                                |     TOR EXIT NODE    |
                                                                                |                      |
                                                                                |  CANNOT know your IP | 
                                                                                |       but KNOWS      |
                                                                                |   your destination   |
                                                                                |                      |
                                                                                +----------------------+
                                                                                            ^
                                                                                            |
                                                                                        DNS | TCP
                                                                                            |
                                                                                            v
                                                                                    +--------------+
                                                                                    |              |
                                                                                    |   INTERNET   |
                                                                                    |              |
                                                                                    +--------------+
```

#### 1. Install Tor:

To install the `tor` package, run:
```
sudo apt install -y tor
```

#### 2. Configure Tor Transparent Proxy:

Start by backing up the default *Tor configuration*:
```
sudo cp /etc/tor/torrc /etc/tor/torrc.bak
```

Then, enable basic logging and set *Tor* to run as a background service:
```
sudo sed -i 's|^#Log notice file /var/log/tor/notices.log|Log notice file /var/log/tor/notices.log|; s|^#RunAsDaemon 1|RunAsDaemon 1|; s|^#DataDirectory /var/lib/tor|DataDirectory /var/lib/tor|' /etc/tor/torrc
```

Append the following configuration to the `torrc` file:
```
sudo tee -a /etc/tor/torrc > /dev/null <<EOF

# Tor Transparent Proxy
VirtualAddrNetworkIPv4 10.192.0.0/12
AutomapHostsSuffixes .onion,.exit
AutomapHostsOnResolve 1

# Bind Transparent Proxy & DNSPort to localhost
TransPort 10.192.0.1:9040
DNSPort 10.192.0.1:9053
EOF
```

Stop the *Tor service* and disable autostart at boot, since we will control the *Tor service* manually:
```
sudo systemctl stop tor@default
```
```
sudo systemctl disable tor@default
```

#### 3. Create NetworkManager Dummy Interface:

As with the *WireGuard* setup, we will use a dedicated *NetworkManager* interface to activate and deactivate the *Tor Transparent Proxy*. Create and configure a dummy interface named `torproxy`:
```
sudo nmcli con add type dummy ifname torproxy con-name torproxy ipv4.method manual ipv4.addresses 10.192.0.1/32
```
```
sudo nmcli con modify torproxy ipv4.ignore-auto-routes yes
```
```
sudo nmcli con modify torproxy ipv4.never-default yes
```
```
sudo nmcli con modify torproxy ipv4.dns 10.192.0.1
```
```
sudo nmcli con modify torproxy autoconnect no
```

Once created, it's a good idea to bring the connection down immediately (in case it auto-connected):
```
sudo nmcli con down torproxy
```

#### 4. Tor Firewall:

The *Tor* firewall configuration is more advanced than the one used with *WireGuard*, as it requires explicit redirection of traffic and additional protections. We’ll use a preconfigured ruleset you can download from our repository.

First, ensure the directory structure for firewall configs exists:
```
[ -d ~/script ] || mkdir ~/script && [ -d ~/script/nftables ] || mkdir ~/script/nftables
```

Then download the Tor firewall config:
```
sudo curl -L -o /home/admin/script/nftables/torproxy.conf "https://codeberg.org/term7/Going-Dark/raw/branch/main/Pi%20Configuration%20Files/nftables/torproxy.conf"
```

This firewall implements all the protections outlined in [18 FIREWALL](#18-firewall), and additionally:

- Redirects all TCP traffic (except SSH on port 6666) to Tor’s TransPort (9040).
- Applies redirection in both the prerouting (for external client traffic) and output (for local traffic) chains, ensuring all TCP connections are forced through Tor.
- Blocks all incoming ICMP echo requests (pings) from the internet to improve stealth.
- Drops all fragmented IP packets, which can be used in evasion or scanning attacks.

It further enhances privacy by blocking ICMP echo-requests from the internet entirely. Additionally, it drops any fragmented IP packets, which can be used for scanning or evasion.

**Tor-Specific Traffic Management**

To prevent routing loops or service disruption, the firewall explicitly allows traffic generated by the *Tor process* itself to bypass redirection. This ensures that *Tor* can establish circuits without interference from the firewall.

The forward chain in this firewall setup is tightly restricted. It only allows forwarding of traffic that has been routed through *Tor*, and blocks all other inter-interface forwarding to maintain strong isolation.

**Special DNS Handling**

The firewall does **not** send DNS traffic directly to *Tor’s DNS port* (9053). Instead, it continues to redirect DNS queries to *AdGuardHome* (port 5357), which in turn forwards them to *Unbound*. We will configure *Unbound* to forward all DNS queries to *Tor's DNSPort* (9053), maintaining DNS filtering while ensuring full anonymization over *Tor*.

#### 5. Dynamically Apply Firewall Rules Using a Dispatcher Script:

Again, we’ll use a *NetworkManager* dispatcher script to automatically switch the firewall and *Unbound* DNS configuration when the torproxy interface connects or disconnects. Additionally, the script will dynamically start and stop the *Tor service* as needed.

When *Tor* is active, *Unbound* switches into a 'Tor mode': instead of performing recursive DNS resolution using root servers, it forwards all DNS queries through the *Tor Transparent Proxy*. These queries are then resolved by a *Tor Exit Node*.

However, because *Tor’s* built-in DNS resolver does not return DNSSEC-related records (such as `DNSKEY` or `RRSIG`), *Unbound* cannot validate DNSSEC in this configuration, even if it is set to enforce it. To prevent this from breaking DNS resolution and internet access, our dispatcher script temporarily enables permissive DNSSEC mode and allows querying localhost (*Tor’s DNSPort*) when the proxy is active. When the interface is deactivated, our original secure settings are restored. Additionally, the script restarts *fail2ban* to reinstate previously banned IPs.

Create the dispatcher script:

```
sudo tee /etc/NetworkManager/dispatcher.d/torproxy-handler > /dev/null << 'EOF'
#!/bin/bash

# Define Interfaces
TOR_INTERFACE="torproxy"

# Define Config Files
TOR_RULES="/home/admin/script/nftables/torproxy.conf"
DEFAULT_RULES="/etc/nftables.conf"
UNBOUND_MAIN_CONFIG="/etc/unbound/unbound.conf.d/unbound-dnssec.conf"
UNBOUND_CONFIG="/etc/unbound/unbound.conf.d/local-zones.conf"

# Define TorProxy  DNS Config
TOR_DNS_CONFIG="# Upstream DNS via Tor\nforward-zone:\n    name: \".\"\n    forward-addr: 10.192.0.1@9053"

case "$1" in
    $TOR_INTERFACE)
        case "$2" in
            up)
                # Apply Tor firewall rules
                /usr/sbin/nft -f "$TOR_RULES"

                # Start Tor service
                sudo systemctl start tor@default

                # Edit Unbound main configuration
                sed -i 's/do-not-query-localhost: yes/do-not-query-localhost: no/' "$UNBOUND_MAIN_CONFIG"
                sed -i 's/val-permissive-mode: no/val-permissive-mode: yes/' "$UNBOUND_MAIN_CONFIG"

                # Append TorProxy DNS to Unbound if not already present
                if ! grep -Fxq "$TOR_DNS_CONFIG" "$UNBOUND_CONFIG"; then
                    echo -e "\n$TOR_DNS_CONFIG" | sudo tee -a "$UNBOUND_CONFIG" > /dev/null
                fi

                sudo systemctl restart unbound
                sudo systemctl restart fail2ban
                ;;

            down)
                # Restore default nftables rules
                /usr/sbin/nft -f "$DEFAULT_RULES"

                # Stop Tor service
                sudo systemctl stop tor@default

                # Restore Unbound main configuration
                sed -i 's/do-not-query-localhost: no/do-not-query-localhost: yes/' "$UNBOUND_MAIN_CONFIG"
                sed -i 's/val-permissive-mode: yes/val-permissive-mode: no/' "$UNBOUND_MAIN_CONFIG"

                # Remove TorProxy DNS Config
                sed -i '/fallback-enabled: yes/,$d' "$UNBOUND_CONFIG"
                echo "        fallback-enabled: yes" | sudo tee -a "$UNBOUND_CONFIG" > /dev/null

                sudo systemctl restart unbound
                sudo systemctl restart fail2ban
                ;;
        esac
        ;;
esac
EOF
```

Make the script executable:
```
sudo chmod +x /etc/NetworkManager/dispatcher.d/torproxy-handler
```

#### 6. Start/Stop Tor Transparent Proxy:

To start *Tor Transparent Proxy*:
```
sudo nmcli con up torproxy
```

To stop *Tor Transparent Proxy*:
```
sudo nmcli con down torproxy
```

#### 7. Test Tor Transparent Proxy:

To verify that your Raspberry Pi is correctly routing traffic through the *Tor network*, run the following command on the Pi:
```
curl https://check.torproject.org/api/ip
```
You should receive a JSON response showing the IP address of a *Tor exit node*, confirming that outbound traffic is being anonymized.

To confirm that a connected client device—such as your Mac—is also being routed through *Tor*, open a browser and visit:<br>
[https://check.torproject.org](https://check.torproject.org)

If everything is working correctly, the page will display a message confirming that your traffic is coming from the *Tor network*.

To check for potential DNS leaks, visit:<br>
[https://dnsleaktest.com](https://dnsleaktest.com)

If you see your home IP address, or the IP of a DNS resolver you've configured manually on your device or router, this indicates a DNS leak. In that case, your *Tor Transparent Proxy* is not properly isolating DNS traffic, and your configuration may need to be revised to ensure DNS requests are also routed through *Tor*.

* * *

## 23 LOCAL WEB CONTROL INTERFACE

At this point, your Raspberry Pi should be fully functional and operating as intended. For now, switching between different modes still requires logging in via SSH and using the command line from your `admin` account.

#### 1. Control the Hotspot:

Start the hotspot:
```
sudo nmcli con up Hotspot
```

Stop the hotspot:
```
sudo nmcli con down Hotspot
```

#### 2. Toggle WireGuard VPN:

Enable *WireGuard*:
```
sudo nmcli con up term7.wireguard
```

Disable *WireGuard*:
```
sudo nmcli con down term7.wireguard
```

#### 3. Toggle Tor Transparent Proxy:

Enable *Tor Transparent Proxy*:
```
sudo nmcli con up torproxy
```

Disable *Tor Transparent Proxy*:
```
sudo nmcli con down torproxy
```

**⚠️ Important: Never run *WireGuard* and *Tor* at the same time. Always disconnect one before activating the other — running both simultaneously will cause conflicts and break routing.**

#### WHAT COMES NEXT:

In the following sections we will show you how to set up a user-friendly control interface that you can reach locally from your browser at: [https://going.dark](https://going.dark)

The web interface will allow you to:

- Connect the Raspberry Pi to a new Wi-Fi network
- Safely power off the device
- Start or stop the hotspot
- Switch between *VPN mode* and *Tor mode*
- Clear *AdGuardHome* queries and statistics

## 24 GOING DARK SSL AND NGINX

Before we start building the actual control interface, we create a second configuration for *NGINX* and a second SSL certificate for a new local website that will be called *going.dark*. To do so, we follow a variation of the process outlined in [16 SSL CERTIFICATE](#16-ssl-certificate) and [17 SETUP NGINX REVERSE PROXY](#17-setup-nginx-reverse-proxy), where we created a self-signed SSL certificate for *adguard.home* and where we set up *NGINX* as a reverse proxy for *adguard.home*. We will again use our self-signed certificate authority - *term7-CA* - which we already set up in chapter 16.


#### 1. Generate SSL Certificates for going.dark:

Move into the SSL configuration directory:
```
cd ~/tools/CA/SSL
```

Create an *OpenSSL Configuration File* for *going.dark*:

```
echo '[ req ]
default_bits       = 2048
default_md         = sha256
prompt             = no
distinguished_name = req_distinguished_name
req_extensions     = v3_req

[ req_distinguished_name ]
CN = going.dark

[ v3_req ]
subjectAltName = @alt_names
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[ alt_names ]
DNS.1 = going.dark
IP.1 = 192.168.77.1' | sudo tee /home/admin/tools/CA/SSL/openssl-goingdark.cnf > /dev/null
```

Now, generate the *Private Key* for *going.dark*:
```
openssl genrsa -out ~/tools/CA/SSL/going.dark.key 2048
```

Create a *Certificate Signing Request (CSR)*:
```
openssl req -new -key going.dark.key -out going.dark.csr -config openssl-goingdark.cnf
```

Sign the *Certificate Signing Request (CSR)* with the existing *Local Certificate Authority (term7-CA)*:
```
openssl x509 -req -in ~/tools/CA/SSL/going.dark.csr -CA ~/tools/CA/term7-CA.pem -CAkey ~/tools/CA/term7-CA.key -CAcreateserial -out ~/tools/CA/SSL/going.dark.crt -days 90 -extensions v3_req -extfile ~/tools/CA/SSL/openssl-goingdark.cnf
```

Create the Full-Chain Certificate:
```
cat ~/tools/CA/SSL/going.dark.crt ~/tools/CA/term7-CA.pem > ~/tools/CA/SSL/going.dark-fullchain.crt
```

You do not need to trust the certificates on your Raspberry Pi and you do not need to transfer your *Local Certificate Authority (term7-CA)* to your Mac, since you have done this in [16 SSL CERTIFICATE](#16-ssl-certificate) already! Also this certificate will automatically renewed once it is close to its expiration date. To add *going.dark* to your existing renewal script, run:

```
sed -i '/^DOMAINS=(/ {/going\.dark/! s/\(adguard\.home"\)[[:space:]]*)/\1 "going.dark")/ }' /home/admin/script/SSL/renew-cert.sh
```



* * *