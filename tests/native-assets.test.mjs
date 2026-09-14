import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {nativeAssetsFixture} from './native-assets-fixture.mjs';

test('distributed preloads contain no captured composer HTML or long native SVG paths', () => {
  for (const file of ['../runtime/preload.cjs','../parked/workflow-before-starter/preload.cjs']) {
    const source = readFileSync(new URL(file,import.meta.url),'utf8');
    assert.doesNotMatch(source,/const nativeComposerExample\s*=/);
    assert.doesNotMatch(source,/["']M[\d., -][^"'\n]{300,}["']/);
  }
});

test('native asset reader initialises audited exports and rejects missing or unsafe SVGs', async () => {
  const source = readFileSync(new URL('../runtime/preload.cjs',import.meta.url),'utf8');
  const reader = source.slice(source.indexOf('async function readWorkflowNativeAssets()'),source.indexOf('\nlet workflowNativeAssets;'));
  const dom = new JSDOM('<script type="module" src="./assets/index-b0a81f126468.js"></script>',{url:'app://-/index.html',runScripts:'outside-only'});
  const expected = JSON.parse(nativeAssetsFixture);
  const specifications = [...reader.matchAll(/\["([\w-]+)", "([\w.-]+\.js)", "(\w+)", "(\w+)", \d+, "[\d ]+"\]/g)];
  assert.equal(specifications.length,13);
  let bad = false, calls = 0;
  const modules = Object.fromEntries([...new Set(specifications.map(m=>m[2]))].map(file=>[file,{}]));
  for (const [,name,file,init,key] of specifications) {
    let ready = false;
    modules[file][init] = () => { ready = true; };
    Object.defineProperty(modules[file],key,{get(){
      assert.ok(ready,'must initialise a cold native export');
      const svg=new dom.window.DOMParser().parseFromString(expected[name],'image/svg+xml').documentElement;
      return {canvas:{viewBox:svg.getAttribute('viewBox')},body:bad?'<image href="https://example.invalid/tracker"/>':svg.innerHTML};
    }});
  }
  dom.window.importNative = async url => {
    calls++;
    const parsed = new URL(url);
    assert.equal(parsed.origin,'null'); assert.equal(parsed.protocol,'app:');
    return modules[parsed.pathname.split('/').at(-1)];
  };
  const run=()=>dom.window.eval('('+reader.replace('await import(', 'await importNative(')+')()');
  try {
    assert.equal(Object.keys(JSON.parse(await run())).length,13);
    bad=true;
    await assert.rejects(run(),/shape changed|Unsafe native SVG/);
    dom.window.document.querySelector('script').remove();
    const before=calls;
    await assert.rejects(run(),/Unaudited native asset entry/);
    assert.equal(calls,before,'unknown entry must not import anything');
  } finally {dom.window.close();}
});
