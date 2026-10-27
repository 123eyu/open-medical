const {join,dirname}=require('node:path');
const {lstatSync,mkdirSync}=require('node:fs');
const {trustedFrame}=require('./permission-help.cjs');
function registerBackupDirectory({ipcMain,shell,getWindow,getOrigin,databasePath}) {
  ipcMain.handle('omw:open-backup-directory',async event=>{
    if(!trustedFrame(event,getWindow(),getOrigin()))throw Error('仅工作台主页面可请求此操作');
    const path=join(dirname(databasePath),'backups');
    try {const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('备份位置不是普通目录');}
    catch(error){if(error.code!=='ENOENT')throw error;mkdirSync(path,{mode:0o700});}
    const error=await shell.openPath(path);if(error)throw Error(`打开备份目录失败：${error}`);
    return {opened:true};
  });
}
module.exports={registerBackupDirectory};
