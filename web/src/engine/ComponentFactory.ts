import { ThemedButtonOptions, ThemedMenuOptions, ThemedModalOptions, ThemedSliderOptions } from './types';

/**
 * ComponentFactory: Creates completely new UI objects that look 100% native
 * in the active theme by inheriting synthesized theme tokens and geometry.
 */
export class ComponentFactory {
    private static instance: ComponentFactory;

    private constructor() {}

    public static getInstance(): ComponentFactory {
        if (!ComponentFactory.instance) {
            ComponentFactory.instance = new ComponentFactory();
        }
        return ComponentFactory.instance;
    }

    /**
     * Creates a themed player icon button matching native player controls.
     */
    public createThemedButton(options: ThemedButtonOptions): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.id = options.id;
        btn.type = 'button';
        btn.className = `playadapt-btn autoSize paper-icon-button-light ${options.className || ''}`;
        btn.setAttribute('is', 'paper-icon-button-light');

        if (options.tooltip) {
            btn.title = options.tooltip;
            btn.setAttribute('aria-label', options.tooltip);
        }

        if (options.active) {
            btn.classList.add('playadapt-btn-active');
        }

        const iconSpan = document.createElement('span');
        iconSpan.className = 'xlargePaperIconButton material-icons';
        iconSpan.textContent = options.icon;
        iconSpan.setAttribute('aria-hidden', 'true');
        btn.appendChild(iconSpan);

        if (options.label) {
            const labelSpan = document.createElement('span');
            labelSpan.className = 'playadapt-btn-label';
            labelSpan.textContent = options.label;
            btn.appendChild(labelSpan);
        }

        if (options.badge) {
            const badgeSpan = document.createElement('span');
            badgeSpan.className = `playadapt-btn-badge ${options.badgeClass || ''}`;
            badgeSpan.textContent = options.badge;
            btn.appendChild(badgeSpan);
        }

        if (options.onClick) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                options.onClick!(e);
            });
        }

        return btn;
    }

    /**
     * Creates a themed floating menu / popup sheet matching the theme's dialog style.
     */
    public createThemedMenu(options: ThemedMenuOptions): { element: HTMLElement; open: () => void; close: () => void } {
        const menu = document.createElement('div');
        menu.id = options.id;
        menu.className = 'playadapt-menu-sheet playadapt-glass-surface';
        menu.style.display = 'none';

        if (options.title) {
            const titleEl = document.createElement('div');
            titleEl.className = 'playadapt-menu-header';
            titleEl.innerHTML = `<span class="playadapt-menu-title">${options.title}</span>`;
            menu.appendChild(titleEl);
        }

        const listEl = document.createElement('div');
        listEl.className = 'playadapt-menu-list';
        menu.appendChild(listEl);

        const renderItems = () => {
            listEl.innerHTML = '';
            const items = typeof options.items === 'function' ? options.items() : options.items;
            items.forEach(item => {
                const itemBtn = document.createElement('button');
                itemBtn.type = 'button';
                itemBtn.className = `playadapt-menu-item ${item.selected ? 'playadapt-menu-item-selected' : ''}`;

                let itemHtml = '';
                if (item.icon) {
                    itemHtml += `<span class="material-icons playadapt-menu-item-icon">${item.icon}</span>`;
                }
                itemHtml += `<span class="playadapt-menu-item-text">${item.label}</span>`;
                if (item.selected) {
                    itemHtml += `<span class="material-icons playadapt-menu-item-check">check</span>`;
                }
                if (item.badge) {
                    itemHtml += `<span class="playadapt-badge">${item.badge}</span>`;
                }

                itemBtn.innerHTML = itemHtml;
                itemBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    item.onClick();
                    close();
                });

                listEl.appendChild(itemBtn);
            });
        };

        if (options.customContent) {
            menu.appendChild(options.customContent);
        }

        document.body.appendChild(menu);

        const positionMenu = () => {
            if (!options.anchorElement) {
                menu.style.bottom = '90px';
                menu.style.top = 'auto';
                menu.style.right = '24px';
                menu.style.maxHeight = 'calc(100vh - 120px)';
                return;
            }

            const rect = options.anchorElement.getBoundingClientRect();
            const menuWidth = Math.min(260, window.innerWidth - 32);
            let left = rect.left + (rect.width / 2) - (menuWidth / 2);
            left = Math.max(16, Math.min(left, window.innerWidth - menuWidth - 16));

            menu.style.left = `${left}px`;
            menu.style.right = 'auto';

            // Smart vertical positioning: if anchor is in top half of screen, open DOWNWARDS
            const isTopHalf = rect.top < (window.innerHeight / 2);
            if (isTopHalf) {
                menu.style.top = `${rect.bottom + 8}px`;
                menu.style.bottom = 'auto';
                menu.style.maxHeight = `${Math.max(120, window.innerHeight - rect.bottom - 24)}px`;
            } else {
                menu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
                menu.style.top = 'auto';
                menu.style.maxHeight = `${Math.max(120, rect.top - 24)}px`;
            }
        };

        const onDocumentClick = (e: MouseEvent) => {
            if (!menu.contains(e.target as Node) && (!options.anchorElement || !options.anchorElement.contains(e.target as Node))) {
                close();
            }
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                close();
            }
        };

        const open = () => {
            renderItems();
            menu.style.display = 'block';
            positionMenu();
            menu.classList.add('playadapt-menu-open');
            document.addEventListener('click', onDocumentClick);
            document.addEventListener('keydown', onKeyDown);
        };

        const close = () => {
            menu.classList.remove('playadapt-menu-open');
            menu.style.display = 'none';
            document.removeEventListener('click', onDocumentClick);
            document.removeEventListener('keydown', onKeyDown);
            if (options.onClose) {
                options.onClose();
            }
        };

        return { element: menu, open, close };
    }

    /**
     * Creates a themed glassmorphic card for HUD or status displays.
     */
    public createThemedCard(id: string, className?: string): HTMLElement {
        const card = document.createElement('div');
        card.id = id;
        card.className = `playadapt-card-hud playadapt-glass-surface ${className || ''}`;
        return card;
    }

    /**
     * Creates a themed slider input.
     */
    public createThemedSlider(options: ThemedSliderOptions): HTMLElement {
        const container = document.createElement('div');
        container.className = 'playadapt-slider-container';

        const slider = document.createElement('input');
        slider.id = options.id;
        slider.type = 'range';
        slider.min = options.min.toString();
        slider.max = options.max.toString();
        slider.step = (options.step || 1).toString();
        slider.value = options.value.toString();
        slider.className = 'playadapt-slider';

        const valDisplay = document.createElement('span');
        valDisplay.className = 'playadapt-slider-val';
        valDisplay.textContent = options.formatValue ? options.formatValue(options.value) : options.value.toString();

        slider.addEventListener('input', () => {
            const v = parseFloat(slider.value);
            valDisplay.textContent = options.formatValue ? options.formatValue(v) : v.toString();
            options.onChange(v);
        });

        container.appendChild(slider);
        container.appendChild(valDisplay);
        return container;
    }

    /**
     * Creates a themed modal dialog.
     */
    public createThemedModal(options: ThemedModalOptions): { element: HTMLElement; open: () => void; close: () => void } {
        const backdrop = document.createElement('div');
        backdrop.id = options.id;
        backdrop.className = 'playadapt-modal-backdrop';
        backdrop.style.display = 'none';

        const modal = document.createElement('div');
        modal.className = 'playadapt-modal-card playadapt-glass-surface';

        const header = document.createElement('div');
        header.className = 'playadapt-modal-header';
        header.innerHTML = `<h3>${options.title}</h3>`;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'playadapt-modal-close';
        closeBtn.innerHTML = '<span class="material-icons">close</span>';
        closeBtn.onclick = () => close();
        header.appendChild(closeBtn);

        const body = document.createElement('div');
        body.className = 'playadapt-modal-body';
        if (typeof options.content === 'string') {
            body.innerHTML = options.content;
        } else {
            body.appendChild(options.content);
        }

        modal.appendChild(header);
        modal.appendChild(body);

        if (options.actions && options.actions.length) {
            const footer = document.createElement('div');
            footer.className = 'playadapt-modal-footer';
            options.actions.forEach(act => {
                const b = document.createElement('button');
                b.className = `playadapt-btn-action ${act.primary ? 'playadapt-btn-primary' : ''}`;
                b.textContent = act.label;
                b.onclick = () => {
                    act.onClick();
                    close();
                };
                footer.appendChild(b);
            });
            modal.appendChild(footer);
        }

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        const open = () => {
            backdrop.style.display = 'flex';
        };

        const close = () => {
            backdrop.style.display = 'none';
            if (options.onClose) options.onClose();
        };

        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) close();
        });

        return { element: backdrop, open, close };
    }

    /**
     * Shows a lightweight, non-intrusive in-player toast notification.
     */
    public showToast(message: string, durationMs: number = 2400): void {
        const toast = document.createElement('div');
        toast.className = 'playadapt-toast playadapt-glass-surface';
        toast.textContent = message;
        document.body.appendChild(toast);

        // Animate in
        requestAnimationFrame(() => {
            toast.classList.add('playadapt-toast-visible');
        });

        // Animate out & remove
        setTimeout(() => {
            toast.classList.remove('playadapt-toast-visible');
            setTimeout(() => {
                if (toast.parentElement) {
                    toast.parentElement.removeChild(toast);
                }
            }, 300);
        }, durationMs);
    }
}
