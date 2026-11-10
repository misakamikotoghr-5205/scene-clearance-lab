"""Render the evidence-bound Chinese Aholo report without any network access.

Requires reportlab and Pillow. Supply a real browser-downloaded A/B report and
sanitized screenshot crops. This tool does not import/publish model binaries.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader

ROOT = Path(__file__).resolve().parents[2]
FONT_PATH = '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
WIDTH, HEIGHT, MARGIN = 595.28, 841.89, 42


def load_json(path, limit=2000000):
    data = Path(path).read_bytes()
    if len(data) > limit:
        raise ValueError('Evidence JSON exceeds its size limit')
    return json.loads(data)


def check_layout(report, digest):
    if report.get('format') != 'scene-clearance-placement-report-v1':
        raise ValueError('Supply the actual browser-downloaded placement report')
    comp, plans = report.get('comparison'), report.get('comparisonPlans')
    if not isinstance(comp, dict) or not isinstance(plans, dict) or comp.get('comparableSettings') is not True:
        raise ValueError('A real comparable A/B report with both snapshots is required')
    for slot in ('a', 'b'):
        plan = plans.get(slot)
        if not isinstance(plan, dict):
            raise ValueError('Both saved plans are required')
        matching = [x for x in plan.get('assets', []) if x.get('source', {}).get('sha256') == digest]
        if len(matching) != 1:
            raise ValueError('Each actual snapshot must bind the recorded generated asset hash')
        if not any(obj.get('assetId') == matching[0].get('id') for obj in plan.get('objects', [])):
            raise ValueError('The generated asset must actually be placed in each snapshot')
        summary = comp.get(slot, {}).get('summary', {})
        for key in ('objects', 'overlaps', 'narrowGaps', 'outside', 'reserved', 'total'):
            if type(summary.get(key)) is not int or summary[key] < 0:
                raise ValueError('Missing actual integer comparison counts')
    for key in ('objects', 'overlaps', 'narrowGaps', 'outside', 'reserved', 'total'):
        if comp.get('delta', {}).get(key) != comp['b']['summary'][key] - comp['a']['summary'][key]:
            raise ValueError('Comparison delta disagrees with the recorded summaries')
    return comp


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--layout-report', required=True)
    parser.add_argument('--image-dir', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    evidence_path = ROOT / 'docs/evidence/lux3d-import-20261110.json'
    evidence = load_json(evidence_path)
    asset = evidence['asset']
    layout = load_json(args.layout_report)
    expected_report_hash = evidence['ab_comparison'].get('current_browser_report_sha256')
    if hashlib.sha256(Path(args.layout_report).read_bytes()).hexdigest() != expected_report_hash:
        raise ValueError('The report bytes do not match the recorded actual browser download')
    comparison = check_layout(layout, asset['sha256'])
    source_path = ROOT / 'docs/aholo-report.md'
    source = source_path.read_text(encoding='utf-8')
    pages = re.split(r'^## 第\d页 ', source, flags=re.M)[1:]
    if len(pages) != 5:
        raise ValueError('Expected five deliberately authored report pages')
    image_dir = Path(args.image_dir).resolve()
    image_names = re.findall(r'\{\{image:([a-z0-9-]+\.png)\|', source)
    for name in image_names:
        image_path = image_dir / name
        if not image_path.is_file() or image_path.stat().st_size > 15000000:
            raise ValueError('Missing bounded actual screenshot crop: ' + name)
    pdfmetrics.registerFont(TTFont('ReportCJK', FONT_PATH, subfontIndex=0))
    styles = {
        'body': ParagraphStyle('body', fontName='ReportCJK', fontSize=10.5, leading=17, textColor=HexColor('#34453d'), wordWrap='CJK'),
        'small': ParagraphStyle('small', fontName='ReportCJK', fontSize=8, leading=12, textColor=HexColor('#55665e'), wordWrap='CJK'),
        'cell': ParagraphStyle('cell', fontName='ReportCJK', fontSize=9, leading=14, textColor=HexColor('#273d32'), wordWrap='CJK'),
    }
    output = Path(args.out); output.parent.mkdir(parents=True, exist_ok=True)
    canvas_pdf = canvas.Canvas(str(output), pagesize=(WIDTH, HEIGHT), pageCompression=1)
    canvas_pdf.setTitle('留白实验室 Aholo 项目报告')
    canvas_pdf.setAuthor('Hengrui Guo')
    content_width = WIDTH - MARGIN * 2

    def data_table(kind):
        if kind == 'asset-file':
            return [['实际文件', '记录'], ['格式及大小', f"{asset['format']} / {asset['bytes']:,} bytes"],
                    ['SHA-256', asset['sha256']]]
        if kind == 'asset-geometry':
            dims = asset['interpreted_dimensions_m']
            return [['实际导入读数', '值'], ['顶点 / 三角形 / 图元', f"{asset['vertices']:,} / {asset['triangles']:,} / {asset['primitives']}"],
                    ['宽 / 深 / 高', f"{dims['width']:.4f} / {dims['depth']:.4f} / {dims['height']:.4f} m"],
                    ['单位 / 纹理', f"glTF默认米，scale {asset['unit_scale']} / {asset['textures']}张纹理"]]
        if kind == 'comparison':
            rows = [['同参数几何代理结果', '方案A', '方案B', 'B - A']]
            for key, label in [('objects', '物件数'), ('overlaps', '重叠/接触'), ('narrowGaps', '小于自定间隙'), ('outside', '房间边界之外'), ('reserved', '进入留白带'), ('total', '提醒总数')]:
                rows.append([label, str(comparison['a']['summary'][key]), str(comparison['b']['summary'][key]), f"{comparison['delta'][key]:+d}"])
            return rows
        raise ValueError('Unsupported table directive')

    for index, page in enumerate(pages, 1):
        title, content = page.split('\n', 1)
        canvas_pdf.setFillColor(HexColor('#fafaf4')); canvas_pdf.rect(0, 0, WIDTH, HEIGHT, fill=1, stroke=0)
        canvas_pdf.setFont('Helvetica', 8); canvas_pdf.setFillColor(HexColor('#60796b'))
        canvas_pdf.drawString(MARGIN, HEIGHT - 35, 'SCENE CLEARANCE LAB / AHOLO 2026')
        title_style = ParagraphStyle('title', parent=styles['body'], fontSize=21, leading=29, textColor=HexColor('#193c2b'))
        paragraph = Paragraph(escape(title.strip()), title_style)
        _, height = paragraph.wrap(content_width, 100)
        paragraph.drawOn(canvas_pdf, MARGIN, HEIGHT - 58 - height)
        y = HEIGHT - 78 - height
        for block in re.split(r'\n\s*\n', content.strip()):
            block = block.strip()
            if not block: continue
            image_match = re.fullmatch(r'\{\{image:([a-z0-9-]+\.png)\|([^}]+)\}\}', block)
            table_match = re.fullmatch(r'\{\{table:([a-z-]+)\}\}', block)
            if image_match:
                name, caption = image_match.groups(); reader = ImageReader(str(image_dir / name)); iw, ih = reader.getSize()
                max_height = {'reference-workspace.png': 190, 'generation-status.png': 66, 'import-overview.png': 245, 'import-provenance.png': 112, 'ab-comparison.png': 235}.get(name, 180)
                scale = min(content_width / iw, max_height / ih); dw, dh = iw * scale, ih * scale
                caption_p = Paragraph(escape(caption), styles['small']); _, ch = caption_p.wrap(content_width, 100)
                if y - dh - ch - 19 < 56: raise ValueError(f'Page {index} image overflows')
                canvas_pdf.drawImage(reader, MARGIN + (content_width - dw) / 2, y - dh, width=dw, height=dh)
                y -= dh + 7; caption_p.drawOn(canvas_pdf, MARGIN, y - ch); y -= ch + 12
                continue
            if table_match:
                rows = data_table(table_match.group(1)); cols = len(rows[0]); widths = ([132, content_width - 132] if cols == 2 else [content_width - 204, 68, 68, 68])
                cells = [[Paragraph(escape(value), styles['cell']) for value in row] for row in rows]
                component = Table(cells, colWidths=widths)
                component.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,0), HexColor('#e4ede5')), ('GRID', (0,0), (-1,-1), .45, HexColor('#cbd5cd')),
                    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'), ('TOPPADDING',(0,0),(-1,-1),7), ('BOTTOMPADDING',(0,0),(-1,-1),7), ('LEFTPADDING',(0,0),(-1,-1),8), ('RIGHTPADDING',(0,0),(-1,-1),8)]))
            else:
                if block == '{{paragraph:comparison-context}}':
                    a = comparison['a']; block = f"两方案检查参数一致：房间{a['room']['width']}×{a['room']['depth']}m，自定间隙{a['clearance']}m，中央留白带{'开启' if a['zone']['enabled'] else '关闭'}、宽{a['zone']['width']}m。数据来自本次实际浏览器下载报告。" 
                if block == '{{paragraph:report-fingerprint}}':
                    block = '实际下载报告SHA-256：' + expected_report_hash
                component = Paragraph(escape(block).replace('\n', '<br/>'), styles['small'] if block.startswith('http') or 'https://' in block else styles['body'])
            _, height = component.wrap(content_width, 700)
            if y - height < 56: raise ValueError(f'Page {index} content overflows: {y-height:.1f}')
            component.drawOn(canvas_pdf, MARGIN, y - height); y -= height + 12
        canvas_pdf.setFillColor(HexColor('#60796b')); canvas_pdf.setFont('ReportCJK', 7.5)
        canvas_pdf.drawString(MARGIN, 27, 'Hengrui Guo / 留白工坊 / AI生成资产及AI辅助开发 / 非商业赛事展示')
        canvas_pdf.setFont('Helvetica', 8); canvas_pdf.drawRightString(WIDTH-MARGIN, 27, f'{index:02d} / 05')
        canvas_pdf.showPage()
    canvas_pdf.save()
    print(json.dumps({'pdf_bytes': output.stat().st_size, 'pdf_sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'pages': 5,
                      'source_sha256': hashlib.sha256(source_path.read_bytes()).hexdigest(), 'layout_report_sha256': hashlib.sha256(Path(args.layout_report).read_bytes()).hexdigest(),
                      'raw_asset_included': False}, ensure_ascii=False))


if __name__ == '__main__':
    main()
