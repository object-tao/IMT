import {test,expect,type Page} from '@playwright/test';
import {estimateRoadTime,type RoadResult,type RoadRequest,type RoadSegment} from '../../shared/road';

async function selectChinaCities(page:Page){
  await page.goto('/');
  await expect(page.getByRole('form',{name:'陆运查询'})).toHaveCount(0);
  const navigation=page.locator('.sidebar nav');
  await expect(navigation.getByRole('button')).toHaveText(['方案工作台','陆运距离与时效',/资源网络/,/方案档案/]);
  await navigation.getByRole('button',{name:'陆运距离与时效',exact:true}).click();
  await expect(page.getByRole('heading',{name:'陆运距离与时效',exact:true})).toBeVisible();
  await expect(page.locator('.breadcrumb')).toContainText('陆运距离与时效');
  await expect(page.getByRole('heading',{name:'运输需求',exact:true})).toHaveCount(0);
  const form=page.getByRole('form',{name:'陆运查询'});
  await expect(form.getByRole('combobox',{name:'陆运起运国家',exact:true})).toHaveValue('CN');
  await expect(form.getByRole('combobox',{name:'陆运目的国家',exact:true})).toHaveValue('CN');
  await form.getByRole('combobox',{name:'陆运起运城市',exact:true}).fill('上海');
  await page.getByRole('listbox',{name:'陆运起运城市候选城市'}).getByRole('option').first().click();
  await form.getByRole('combobox',{name:'陆运目的城市',exact:true}).fill('成都');
  await page.getByRole('listbox',{name:'陆运目的城市候选城市'}).getByRole('option').first().click();
  return form;
}
async function fixtureResult(page:Page,request:RoadRequest):Promise<RoadResult>{
  const origin=(await (await page.request.get(`/api/geo/cities?country=CN&q=Shanghai`)).json()).items.find((c:any)=>c.id===request.originCityId);
  const destination=(await (await page.request.get(`/api/geo/cities?country=CN&q=Chengdu`)).json()).items.find((c:any)=>c.id===request.destinationCityId);
  const segments:RoadSegment[]=[{kind:'road',name:'公路',distanceMeters:1800000,durationSeconds:64800}],additionalHours=(request.loadingHours??0)+(request.waitingHours??0)+(request.borderHours??0);
  return {provider:'amap',providerName:'高德普通驾车',sourceUrl:'https://lbs.amap.com/api/webservice/guide/api/newroute',queriedAt:'2026-10-22T04:00:00Z',cached:false,resultSource:'api',origin,destination,request,segments,
    roadKm:1800,totalKm:1800,drivingHours:30,transferHours:0,providerHours:18,additionalHours,mapDrivingHours:18,routingMode:'car',
    single:estimateRoadTime([{...segments[0],durationSeconds:30*3600}],request.singleDailyHours,additionalHours,request.departureAt),dual:estimateRoadTime([{...segments[0],durationSeconds:30*3600}],request.dualDailyHours,additionalHours,request.departureAt),
    warnings:['浏览器验收专用固定响应；不是真实路线或报价。','普通驾车参考路线，不校验货车限高、限重和限行。','装卸耗时未计入。']};
}

test('未配置国内普通驾车服务时给出开通指引，不出现虚构距离',async({page})=>{
  const form=await selectChinaCities(page);
  await form.getByRole('button',{name:'查询陆运距离'}).click();
  await expect(page.locator('.road-error')).toContainText('AMAP_WEB_SERVICE_KEY');
  await expect(page.getByRole('region',{name:'陆运查询结果'})).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  await page.getByText('时效测算参数',{exact:false}).first().click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('展示公路距离、驾驶和双模式时效；更改国家立即清除结果和城市',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  let queries=0;
  await page.route('**/api/road/query',async route=>{
    const response=await fixtureResult(page,route.request().postDataJSON());
    if(++queries===2){response.cached=true;response.resultSource='database';response.warnings.push('本次使用数据库历史路线，不代表实时路况。');}
    await route.fulfill({json:response});
  });
  const form=await selectChinaCities(page);
  await form.getByRole('button',{name:'查询陆运距离'}).click();
  const result=page.getByRole('region',{name:'陆运查询结果'});
  await expect(result).toBeVisible();await expect(result).toContainText('1,800');await expect(result.locator('.road-metrics')).toContainText('78');await expect(result.locator('.road-metrics')).toContainText('38');
  await expect(result).toContainText('装卸耗时未计入');await expect(result).toContainText('北京时间');
  await form.getByRole('button',{name:'查询陆运距离'}).click();
  await expect(result).toContainText('数据库记录（本次未调用 API）');await expect(result).toContainText('2026');await expect(result).toContainText('不代表实时路况');
  await page.screenshot({path:'test-results/road-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.getByText('时效测算参数',{exact:false}).first().click();
  await form.getByLabel('卡车参考平均车速 km/h',{exact:true}).fill('65');
  await expect(result).toHaveCount(0);
  await form.getByRole('button',{name:'查询陆运距离'}).click();await expect(result).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/road-mobile.png',fullPage:true});
  await form.getByRole('combobox',{name:'陆运起运国家',exact:true}).selectOption('US');
  await expect(result).toHaveCount(0);await expect(form.getByRole('combobox',{name:'陆运起运城市',exact:true})).toHaveValue('');
  expect(errors).toEqual([]);
});

test('接口等待过程中修改条件，旧响应不能显示为新条件的结果',async({page})=>{
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/road/query',async route=>{const result=await fixtureResult(page,route.request().postDataJSON());await gate;await route.fulfill({json:result});});
  const form=await selectChinaCities(page);
  const sent=page.waitForRequest('**/api/road/query');await form.getByRole('button',{name:'查询陆运距离'}).click();await sent;
  await form.getByRole('combobox',{name:'陆运目的国家',exact:true}).selectOption('US');
  const response=page.waitForResponse('**/api/road/query');release();await response;
  await expect(page.getByRole('region',{name:'陆运查询结果'})).toHaveCount(0);
  await expect(form.getByRole('combobox',{name:'陆运目的城市',exact:true})).toHaveValue('');
});
