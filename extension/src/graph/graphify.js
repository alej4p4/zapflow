// Graphify — renderizador de grafo mínimo SVG (sem dependências externas)
// Uso: new Graphify(container, nodes, edges).render()
class Graphify {
  constructor(container, { nodes = [], edges = [] } = {}) {
    this.container = container;
    this.nodes = nodes;
    this.edges = edges;
    this.width = container.clientWidth || 300;
    this.height = container.clientHeight || 300;
    this.radius = 24;
  }

  render() {
    // Garante layout se não houver coordenadas
    const precisaLayout = this.nodes.some(n => n.x === undefined || n.y === undefined);
    if (precisaLayout) this.layout();

    this.container.innerHTML = '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', this.width);
    svg.setAttribute('height', this.height);
    svg.setAttribute('class', 'zf-graph-svg');

    // Definições (seta)
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'arrow');
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '10');
    marker.setAttribute('refX', '20');
    marker.setAttribute('refY', '5');
    marker.setAttribute('orient', 'auto');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', '0,0 10,5 0,10');
    poly.setAttribute('fill', '#25d366');
    marker.appendChild(poly);
    defs.appendChild(marker);
    svg.appendChild(defs);

    // Grupo de arestas (fazem parte de trás)
    const grupoArestas = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    grupoArestas.setAttribute('class', 'zf-graph-edges');

    // Desenha arestas
    this.edges.forEach((e) => {
      const a = this.nodes.find((n) => n.id === e.from);
      const b = this.nodes.find((n) => n.id === e.to);
      if (!a || !b) return;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', a.x || this.width / 2);
      line.setAttribute('y1', a.y || this.height / 2);
      line.setAttribute('x2', b.x || this.width / 2);
      line.setAttribute('y2', b.y || this.height / 2);
      line.setAttribute('stroke', '#1e425c');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('marker-end', 'url(#arrow)');
      grupoArestas.appendChild(line);
    });
    svg.appendChild(grupoArestas);

    // Grupo de nós (ficam na frente)
    const grupoNos = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    grupoNos.setAttribute('class', 'zf-graph-nodes');

    // Desenha nós
    this.nodes.forEach((n) => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'zf-graph-node');
      g.setAttribute('transform', `translate(${n.x || this.width / 2},${n.y || this.height / 2})`);

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', this.radius);
      circle.setAttribute('fill', n.color || '#0e1a24');
      circle.setAttribute('stroke', '#25d366');
      circle.setAttribute('stroke-width', '2');

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', '0');
      text.setAttribute('y', '5');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', '#eaeaea');
      text.setAttribute('font-size', '11');
      text.setAttribute('font-weight', '600');
      text.textContent = n.label || n.id;

      g.appendChild(circle);
      g.appendChild(text);
      grupoNos.appendChild(g);
    });
    svg.appendChild(grupoNos);

    this.container.appendChild(svg);
  }

  // Layout simples: disposição circular
  layout() {
    const n = this.nodes.length;
    if (n === 0) return;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const radius = Math.min(this.width, this.height) * 0.35;

    this.nodes.forEach((node, i) => {
      const angle = (i / n) * Math.PI * 2;
      node.x = cx + Math.cos(angle) * radius;
      node.y = cy + Math.sin(angle) * radius;
    });
  }
}

window.Graphify = Graphify;
