"""Startskript: setzt Rechte auf /data (Unraid: PUID/PGID), gibt Root-Rechte ab und startet den Server."""
import os


def fix_permissions(path: str, uid: int, gid: int):
    os.makedirs(path, exist_ok=True)
    for root, _dirs, files in os.walk(path):
        for p in [root, *(os.path.join(root, f) for f in files)]:
            try:
                os.chown(p, uid, gid)
            except OSError:
                pass


def main():
    data_dir = os.path.dirname(os.environ.get("DB_PATH", "/data/vokabeln.db")) or "."
    if os.getuid() == 0:
        uid = int(os.environ.get("PUID", "99"))    # Unraid: nobody
        gid = int(os.environ.get("PGID", "100"))   # Unraid: users
        fix_permissions(data_dir, uid, gid)
        os.setgroups([])
        os.setgid(gid)
        os.setuid(uid)
    os.umask(int(os.environ.get("UMASK", "002"), 8))

    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8080")), proxy_headers=True)


if __name__ == "__main__":
    main()
