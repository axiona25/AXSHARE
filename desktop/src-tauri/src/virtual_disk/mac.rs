#![allow(dead_code)]
//! Disco virtuale AXSHARE su macOS tramite macFUSE.

use std::ffi::OsStr;
use std::time::{Duration, SystemTime};

use fuser::{
    FileAttr, FileType, Filesystem, MountOption, ReplyAttr, ReplyDirectory, ReplyEntry, Request,
};

use crate::api_client::{ApiClient, FileMeta, FolderMeta};

const TTL: Duration = Duration::from_secs(1);

struct AxshareFS {
    api: ApiClient,
    #[allow(dead_code)]
    file_cache: std::collections::HashMap<u64, Vec<u8>>,
    #[allow(dead_code)]
    inodes: std::collections::HashMap<u64, InodeEntry>,
    #[allow(dead_code)]
    next_inode: u64,
}

#[derive(Clone)]
enum InodeEntry {
    Folder(FolderMeta),
    File(FileMeta),
}

impl AxshareFS {
    fn new(api: ApiClient) -> Self {
        Self {
            api,
            file_cache: std::collections::HashMap::new(),
            inodes: std::collections::HashMap::new(),
            next_inode: 2, // inode 1 = root
        }
    }

    fn make_file_attr(&self, inode: u64, size: u64, kind: FileType) -> FileAttr {
        let now = SystemTime::now();
        FileAttr {
            ino: inode,
            size,
            blocks: (size + 511) / 512,
            atime: now,
            mtime: now,
            ctime: now,
            crtime: now,
            kind,
            perm: if kind == FileType::Directory { 0o755 } else { 0o644 },
            nlink: 1,
            uid: unsafe { libc::getuid() as u32 },
            gid: unsafe { libc::getgid() as u32 },
            rdev: 0,
            blksize: 512,
            flags: 0,
        }
    }
}

// v1: filesystem read-only. lookup/getattr/readdir espongono solo la root.
// Write (upload) e decifratura on-the-fly in v2.

impl Filesystem for AxshareFS {
    fn lookup(&mut self, _req: &Request<'_>, _parent: u64, _name: &OsStr, reply: ReplyEntry) {
        reply.error(libc::ENOENT);
    }

    fn getattr(&mut self, _req: &Request<'_>, ino: u64, reply: ReplyAttr) {
        if ino == 1 {
            let attr = self.make_file_attr(1, 0, FileType::Directory);
            reply.attr(&TTL, &attr);
            return;
        }
        reply.error(libc::ENOENT);
    }

    fn readdir(
        &mut self,
        _req: &Request<'_>,
        ino: u64,
        _fh: u64,
        offset: i64,
        mut reply: ReplyDirectory,
    ) {
        if ino != 1 {
            reply.error(libc::ENOENT);
            return;
        }
        if offset == 0 {
            let _ = reply.add(1, 0, FileType::Directory, ".");
            let _ = reply.add(1, 1, FileType::Directory, "..");
        }
        reply.ok();
    }
}

pub async fn mount(config: &crate::virtual_disk::VirtualDiskConfig) -> Result<(), String> {
    let mount_point = config.mount_point.clone();
    let mount_point_log = mount_point.clone();
    let api = config.api_client.clone();

    std::thread::spawn(move || {
        let fs = AxshareFS::new(api);
        let options = vec![
            MountOption::FSName("AXSHARE".to_string()),
            MountOption::Subtype("axshare".to_string()),
            MountOption::AutoUnmount,
            MountOption::AllowOther,
        ];
        if let Err(e) = fuser::mount2(fs, &mount_point, &options) {
            log::error!("FUSE mount error: {}", e);
        }
    });

    log::info!("FUSE filesystem mounted at {}", mount_point_log);
    Ok(())
}

pub async fn unmount() -> Result<(), String> {
    // macFUSE si smonta con AutoUnmount alla chiusura del processo.
    // Per smontaggio manuale: std::process::Command::new("diskutil").args(["unmount", mount_point]).spawn()
    Ok(())
}
