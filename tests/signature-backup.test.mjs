import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {test} from "node:test";
import {backupAppleSignature,restoreAppleSignature} from "../scripts/lib.mjs";

test("signature backups preserve extended attributes on native profile files", () => {
  const root=mkdtempSync(join(tmpdir(),"workflow-signature-attributes-"));
  try {
    const app=join(root,"Codex.app"), backup=join(root,"backup");
    const profile=join(app,"Contents","embedded.provisionprofile");
    mkdirSync(join(app,"Contents","_CodeSignature"),{recursive:true});
    writeFileSync(join(app,"Contents","_CodeSignature","CodeResources"),"fixture seal");
    writeFileSync(profile,"fixture profile");
    // A harmless attribute exercises the same native copying mechanism used
    // for com.apple.cs.CodeDirectory/CodeSignature on the installed profile.
    const attribute="com.codex.workflow.signature-test";
    execFileSync("/usr/bin/xattr",["-w",attribute,"preserve-me",profile]);
    backupAppleSignature(backup,app);
    const saved=join(backup,"AppleSignature","embedded.provisionprofile");
    assert.equal(execFileSync("/usr/bin/xattr",["-p",attribute,saved],{encoding:"utf8"}).trim(),"preserve-me");
    rmSync(profile);
    assert.equal(restoreAppleSignature(backup,app),true);
    assert.equal(execFileSync("/usr/bin/xattr",["-p",attribute,profile],{encoding:"utf8"}).trim(),"preserve-me");
  } finally {rmSync(root,{recursive:true,force:true});}
});
