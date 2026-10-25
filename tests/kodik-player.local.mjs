import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch();
try {
 const page=await browser.newPage();
 await page.addInitScript(()=>new MutationObserver((_,o)=>{const n=document.querySelector('#anime-player');if(n){n.style.marginTop='1500px';o.disconnect()}}).observe(document,{childList:true,subtree:true}));
 await page.route('https://anilibria.top/api/v1/**',route=>route.fulfill({status:403,body:'Provider unavailable test double'}));
 let requests=0;
 await page.route('https://kodikplayer.com/**',route=>{requests++;return route.fulfill({contentType:'text/html',body:'<button>Provider controls fixture</button>'})});
 const base=process.env.ANIREZIK_TEST_URL||'http://127.0.0.1:4321/';
 await page.goto(new URL('player-test-kodik/',base).href);
 await page.locator('[data-player][data-ready="true"]').waitFor();
 assert.equal(await page.locator('[data-video-provider]').inputValue(),'kodik');
 assert.equal(await page.locator('.player-episodes button').count(),11);
 assert.equal(await page.locator('iframe').count(),0);assert.equal(requests,0);
 await page.locator('[data-video-surface]').scrollIntoViewIfNeeded(); await page.locator('iframe').waitFor();
 await page.getByRole('button',{name:'Выбрать серию 2',exact:true}).click();
 assert.match(await page.locator('iframe').getAttribute('src'),/episode=2$/);
 assert.equal(await page.locator('iframe').count(),1);
 assert.equal(await page.locator('iframe').getAttribute('referrerpolicy'),'strict-origin-when-cross-origin');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
  const controls=await page.locator('.player-options').boundingBox(),frame=await page.locator('iframe').boundingBox();
  assert.ok(controls.y+controls.height <= frame.y);
  assert.equal(await page.locator('.mobile-nav').isVisible(),false);
  await page.screenshot({path:'.cache/kodik-research/main-'+width+'.png',fullPage:true});
 }
 console.log('PASS: exact title/mapping, Kodik default, lazy iframe, 11 episodes, episode navigation, no overlap, mobile width');
}finally{await browser.close()}
