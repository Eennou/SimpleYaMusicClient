const cloneStyleSheets = element => {
  const sheets = [...(element.styleSheets || [])]
  const styleSheets = sheets.map(styleSheet => {
    try {
      const rulesText = [...styleSheet.cssRules].map(rule => rule.cssText).join("")
      let res = new CSSStyleSheet()
      res.replaceSync(rulesText)
      return res
    } catch (e) {
    }
  }).filter(Boolean)
  if (element===document) return styleSheets
  if (!element.parentElement) return cloneStyleSheets(document).concat(styleSheets)
  return cloneStyleSheets(element.parentElement).concat(styleSheets)
}

class CustomSelect extends HTMLElement {
  constructor() {
    super();
    this.select = undefined;
    this.option_container = undefined;
    this.icon = undefined;
  }
  render() {
    let options = Array.from(this.children);
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.select = document.createElement("span");
    this.select.setAttribute("tabindex", 0);
    this.select.classList = "custom-select " + this.classList;
    this.option_container = document.createElement("div");
    this.select.innerText = options[1].innerText;
    this.toggleOptions("hidden");
    this.shadowRoot.appendChild(this.select);
    this.shadowRoot.appendChild(this.option_container);
    options.forEach(this.generateOption.bind(this))
    ;
    this.addEventListener("focus", this.toggleOptions.bind(this, "visible"));
    this.addEventListener("blur", this.toggleOptions.bind(this, "hidden"));
    
    this.shadowRoot.adoptedStyleSheets = cloneStyleSheets(this);
    this.select.appendChild(this.icon);
    this.select.style.width = this.option_container.clientWidth + "px";
  }

  toggleOptions(state) {
    this.option_container.classList = "custom-select option-container " + state;
  }

  generateOption (elem, index) {
    if (elem.tagName != "OPTION") {
        this.icon = elem;
        return;
    }
    let name = this.getAttribute("name");
    let option = document.createElement("div");
    let option_input = document.createElement("input");
    let label = document.createElement("label");
    option.classList = "option";
    option_input.type = "radio";
    option_input.value = elem.innerText;
    option_input.name = name;
    option_input.id = name + index;
    label.for = name + index;
    label.appendChild(document.createTextNode(elem.innerText));
    option.appendChild(option_input);
    option.appendChild(label);
    this.option_container.appendChild(option);
    option_input.addEventListener("change", this.changeValue.bind(this, option_input.value));
  }

  changeValue(value) {
    this.setAttribute("value", value);
  }

  connectedCallback() {
    if (!this.rendered) {
      this.render();
      this.rendered = true;
    }
  }

  static get observedAttributes() {
    return ["value"];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name == "value") {
      this.select.innerText = newValue;
      this.select.appendChild(this.icon);
    }
  }
}

customElements.define("custom-select", CustomSelect);