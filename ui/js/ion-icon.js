String.prototype.replaceAll = function(search, replacement) {
    var target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
};

class IonIcon extends HTMLElement {
  constructor() {
    super();
  }
  render() {
    let name = this.getAttribute("name");
    let thisElem = this;
    document.getResource(`icons/${name}.svg`).then((result) => {
        let color = window.getComputedStyle(thisElem).getPropertyValue("color");
        result = result.replaceAll("stroke:#000", "stroke:"+color).replaceAll("fill:#000", "fill:"+color);
        thisElem.innerHTML = result.replaceAll("stroke-width:48px", "stroke-width: var(--ionicon-stroke-width)").replaceAll("stroke-width:32px", "stroke-width: var(--ionicon-stroke-width)");
        let svg = thisElem.querySelector("svg");
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        svg.querySelector("title").remove();
        svg.style.fill = color;
        svg.style.stroke = color;
    });
  }

  connectedCallback() {
    if (!this.rendered) {
      this.render();
      this.rendered = true;
    }
  }

  static get observedAttributes() {
    return ["name"];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    this.render();
  }
}

customElements.define("ion-icon", IonIcon);