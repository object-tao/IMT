# 资源导入指南

界面可手工录入所有字段。批量导入支持 UTF-8 CSV 和资源 JSON 备份，大小不超过 5 MB。

## 推荐顺序

供应商 → 运输节点 → 分段线路 → 运价 → 汇率。跨表关联使用稳定 ID，不使用名称猜测对应关系。ID 可由字母、数字、横线、下划线和点组成，首字符必须是字母或数字，最长 100 位。

CSV 只导入当前分类。点击该分类「CSV 模板」获得完整字段示例；模板为虚构内容，需要替换。JSON 可同时包含 suppliers、nodes、lanes、rates、fx 五组数组，允许在一批内导入互相关联资源。先预览，再提交，服务端再次校验后原子写入。

导入仅新增，不覆盖已存在 ID。修改已有资源请使用编辑，避免批量文件意外改写其他人的资料。空白 CSV id 会自动生成；其他资源要引用时应提前指定 ID。version 由系统管理。

## 主要字段约定

| 分类 | 字段 |
| --- | --- |
| 供应商 | id、name、contact、notes |
| 节点 | id、name、city、cityId、country、type、timeZone |
| 线路 | id、name、supplierId、from、to、mode、transitHours、handlingHours、validFrom、validTo、onDemand、schedule、capabilities、尺寸重量上限、services |
| 运价 | id、name、laneId、currency、unit、price、minimum、rounding、volumetricDivisor、bands、surcharges、containerType、validFrom、validTo |
| 汇率 | id、currency、toCny、validFrom、validTo |

日期为 YYYY-MM-DD；币种为三位大写字母。国家存储 ISO 两位代码（如 CN / GB / US），兼容可识别的旧国家名称。cityId 为 GeoNames 城市 ID；同名城市必须提供 ID 明确归属。节点时区例：Asia/Shanghai、Europe/London、America/New_York。

type：city / warehouse / airport / port / rail / border。mode：road / rail / air / sea / transfer。

unit：kg / chargeableKg / cbm / vehicle / container / shipment。onDemand：true / false。尺寸上限单位为 cm，重量为 kg，体积为 m³。

capabilities 中 oversized、hazardous、batteryInstalled、batteryPacked、batteryOnly、liquid、temperature 分别填写 yes / no / unknown。复杂字段在 CSV 单元格内按模板 JSON 格式维护；建议这些字段先用界面录入，再导出查看结构。

示例班期：`{"weekdays":[1,3,5],"departureTime":"18:00","timeZone":"Asia/Shanghai","cutoffHours":8}`。星期日为 0，星期六为 6。

示例阶梯：`[{"upTo":100,"price":25},{"upTo":500,"price":22}]`。示例附加费：`[{"name":"燃油","kind":"percent","amount":10}]`。

缺省值和全部数据约束以 `shared/model.ts` 为准。服务范围说明不要包含应在客户版隐藏的供应商联系信息；自由文本不会自动识别、删除商业名称。

## 真实资料接入

当前未拿到用户真实表格，不预设其表头与费率结构。收到脱敏文件后，应制作字段映射，人工核对至少几票计算，再导入正式资源库。不要把真实文件上传到公开 GitHub 仓库。
