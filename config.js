// Öffentlicher VAPID-Schlüssel (siehe README, Schritt 2). Der private Schlüssel gehört NUR in die GitHub Secrets.
window.APP_CONFIG = {
  VAPID_PUBLIC_KEY: 'BOXQzCLZc8LyLYQuhkgGqqs_2i3IToIZ6cNeuiZxgR5ZIo7rw6cha96RuF4jQ7cUmXYn3E0GlQFolbQQbM2lNzQ',
  // Leer lassen, wenn die App unter https://<user>.github.io/<repo>/ läuft – dann wird das Repo automatisch erkannt.
  // Sonst z. B. 'deinname/bandbewerbungen'.
  GITHUB_REPO: '',
  BRANCH: 'main',
};
