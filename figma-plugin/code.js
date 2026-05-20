// Adobe Bridge - Figma Plugin (code.js)
// Runs in the Figma sandbox - communicates with the UI via postMessage
// The UI (ui.html) holds the WebSocket connection to the bridge app

figma.showUI(__html__, { width: 240, height: 300, title: 'Adobe Bridge' });

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => {
    const h = Math.round(v * 255).toString(16);
    return h.length === 1 ? '0' + h : h;
  }).join('');
}

function getFill(node) {
  if (!node.fills || !node.fills.length) return null;
  const fill = node.fills.find(f => f.visible !== false && f.type === 'SOLID');
  if (!fill) return null;
  return { hex: rgbToHex(fill.color.r, fill.color.g, fill.color.b), opacity: fill.opacity ?? 1 };
}

function getStroke(node) {
  if (!node.strokes || !node.strokes.length) return null;
  const stroke = node.strokes.find(s => s.visible !== false && s.type === 'SOLID');
  if (!stroke) return null;
  return {
    hex: rgbToHex(stroke.color.r, stroke.color.g, stroke.color.b),
    opacity: stroke.opacity ?? 1,
    weight: node.strokeWeight || 1
  };
}

function serializeNode(node) {
  const { x, y, width, height } = node.absoluteBoundingBox || node;
  const base = {
    id: node.id,
    name: node.name,
    type: node.type,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    opacity: node.opacity ?? 1,
    rotation: node.rotation ?? 0,
    visible: node.visible !== false
  };

  if (node.type === 'TEXT') {
    base.text = node.characters || '';
    base.fontSize = node.fontSize || 12;
    base.fontFamily = node.fontName?.family || 'Arial';
    base.fontStyle = node.fontName?.style || 'Regular';
    base.fill = getFill(node);
    base.textAlignHorizontal = node.textAlignHorizontal || 'LEFT';
    base.letterSpacing = node.letterSpacing?.value || 0;
    base.lineHeight = node.lineHeight?.value || null;
  } else if (node.type === 'RECTANGLE' || node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
    base.fill = getFill(node);
    base.stroke = getStroke(node);
    base.cornerRadius = node.cornerRadius || 0;
  } else if (node.type === 'ELLIPSE') {
    base.fill = getFill(node);
    base.stroke = getStroke(node);
  } else if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION' || node.type === 'STAR' || node.type === 'POLYGON') {
    base.fill = getFill(node);
    base.stroke = getStroke(node);
  }

  return base;
}

function getSelection() {
  const sel = figma.currentPage.selection;
  if (!sel.length) return null;

  const page = figma.currentPage;
  const items = sel.map(serializeNode);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const item of items) {
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + item.width);
    maxY = Math.max(maxY, item.y + item.height);
  }

  return {
    docName: page.name,
    selectedCount: items.length,
    artboard: {
      name: page.name,
      width: Math.round(maxX - minX),
      height: Math.round(maxY - minY)
    },
    items
  };
}

figma.ui.onmessage = (msg) => {
  if (msg.type === 'get-selection') {
    const data = getSelection();
    figma.ui.postMessage({ type: 'selection', data });
  }
  if (msg.type === 'poll-selection') {
    const sel = figma.currentPage.selection;
    figma.ui.postMessage({ type: 'selection-count', count: sel.length, names: sel.map(n => n.name) });
  }
  if (msg.type === 'close') {
    figma.closePlugin();
  }
};

setInterval(() => {
  const sel = figma.currentPage.selection;
  figma.ui.postMessage({ type: 'selection-count', count: sel.length, names: sel.map(n => n.name) });
}, 1000);
