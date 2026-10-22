import {test,expect,type Page} from '@playwright/test';
import {estimateRoadTime,type RoadResult,type RoadRequest,type RoadSegment} from '../../shared/road';

async function selectChinaCities(page:Page){
  await page.goto('/');await page.getByText('陆运距离与时效',{exact:true}).click();
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
  return {provider:'amap',providerName:'高德货车路线',sourceUrl:'https://lbs.amap.com/api/logistic-service/guide/wagon_path/hc-route-plan',queriedAt:'2026-10-22T04:00:00Z',cached:false,origin,destination,request,segments,
    roadKm:1800,totalKm:1800,drivingHours:18,transferHours:0,providerHours:18,additionalHours,
    single:estimateRoadTime(segments,request.singleDailyHours,additionalHours,request.departureAt),dual:estimateRoadTime(segments,request.dualDailyHours,additionalHours,request.departureAt),
    warnings:['浏览器验收专用固定响应；不是真实路线或报价。','当前车辆参数来自测算模板，尚未按实际车辆确认。','装卸耗时未计入。']};
}

test('未配置国内货车服务时给出开通指引，不出现虚构距离',async({page})=>{
  const form=await selectChinaCities(page);
  await form.getByRole('button',{name:'查询陆运距离'}).click();
  await expect(page.locator('.road-error')).toContainText('AMAP_TRUCK_KEY');
  await expect(page.getByRole('region',{name:'陆运查询结果'})).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  await page.getByText('车辆参数与时效假设',{exact:false}).first().click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('展示公路距离、驾驶和双模式时效；更改国家立即清除结果和城市',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/road/query',async route=>route.fulfill({json:await fixtureResult(page,route.request().postDataJSON())}));
  const form=await selectChinaCities(page);
  await form.getByRole('button',{name:'查询陆运距离'}).click();
  const result=page.getByRole('region',{name:'陆运查询结果'});
  await expect(result).toBeVisible();await expect(result).toContainText('1,800');await expect(result.locator('.road-metrics')).toContainText('50');await expect(result.locator('.road-metrics')).toContainText('26');
  await expect(result).toContainText('装卸耗时未计入');await expect(result).toContainText('北京时间');
  await page.screenshot({path:'test-results/road-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.getByText('车辆参数与时效假设',{exact:false}).first().click();
  await form.getByLabel('实际车货总重 t',{exact:true}).fill('19');
  await expect(result).toHaveCount(0);
  await expect(form.getByLabel('已按实际车辆确认以上参数')).not.toBeChecked();
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
