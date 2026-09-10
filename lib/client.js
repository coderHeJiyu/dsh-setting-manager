// dsh-setting-manager · Client 端（lazy-CJS factory）
// v0.1：右键设置页分区导航（settings.section 的投影）→ 弹出勾选菜单 →
// 对被勾选隐藏的分区行只设 style.display='none'（纯视觉，刷新不丢：
// 状态经 fetch 读写 Host，持久于 $DSH_HOME/dsh-setting-manager.json，跨浏览器共享；
// 不注销 slot、不卸载组件、不切激活分区、不改内容区）。
// typeof window 守卫：浏览器 bundle 内照常经 ModuleLoader 注册 factory；node 内 import 不得抛错。
// 契约：factory(require) 必须 return 带 name/apply/inject 的对象（loader 以该对象为插件）。
if (typeof window !== 'undefined' && window.__ModuleLoader__) {
	window.__ModuleLoader__.load({
		id: 'dsh-setting-manager',
		factory: (require) => {
			var module = { exports: {} };
			var exports = module.exports;
			Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
			// label 解析（thunk 按当前语言求值）：优先取 ui-slots 包的同名实现；
			// 包不可解析时回退到语义完全相同的本地实现，不让模块装载中断。
			var resolveSlotLabel;
			try {
				var slotsPkg = require('@deepseek-ai/dsh-client-ui-slots');
				resolveSlotLabel = (slotsPkg && typeof slotsPkg.resolveSlotLabel === 'function')
					? slotsPkg.resolveSlotLabel
					: function (label) { return typeof label === 'function' ? label() : label; };
			} catch (err) {
				void err;
				resolveSlotLabel = function (label) { return typeof label === 'function' ? label() : label; };
			}

			// 瞬态工作缓存（非持久状态源）：被隐藏分区的 id 集合。真源永远是 Host 文件；
			// 菜单打开时与每次重放前都经 readHidden() 覆盖。
			var hidden = [];
			// localDirty：刚发生本地写（fire-and-forget POST），其紧随的重放应信任本地
			// 缓存、不发 GET。POST 可能尚未落盘，紧随的 GET 会读到旧值覆盖乐观缓存
			// （「本地写后重放 GET 读旧值」竞态）。由写后第一次 syncHiddenFromHost
			// （正常是 closeMenu 的同一同步任务链内的 replay）消费。下一次重放
			// （菜单再开/关、locale、slot 事件）正常重新读同步。
			var localDirty = false;

			var API = '/api/setting-manager';

			/** 从 Host 读 hidden ids（GET）。Host 不可用 / 响应异常 → 视为全显示，UI 不崩。 */
			async function readHidden() {
				try {
					var r = await fetch(API);
					if (!r.ok) throw 0;
					var o = await r.json();
					return Array.isArray(o.hidden) ? o.hidden : [];
				} catch (err) {
					void err;
					return [];
				}
			}

			/** 向 Host 写 hidden ids（POST）。写失败不阻塞 UI：乐观更新，下次重放再同步。 */
			async function writeHidden(ids) {
				try {
					await fetch(API, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ hidden: ids }),
					});
				} catch (err) {
					void err;
				}
			}

			// 右键菜单状态（仅在弹出期间存在）。
			var menuEl = null;
			var lastNav = null;
			var onDocMousedown = null;
			var onDocKeydown = null;

			var name = 'dsh-setting-manager';

			function apply(ctx) {
				// 服务代理对缺席/未就绪的服务可能抛错：读取本身也要设防。
				var slots = null;
				try {
					slots = ctx && ctx.slots;
				} catch (err) {
					void err;
					slots = null;
				}
				if (!slots || typeof slots.entries !== 'function') return undefined;
				var locale = null;
				try {
					locale = ctx && ctx.locale;
				} catch (err) {
					void err;
					locale = null;
				}
				var cleanupFns = [];

				/** 当前 settings.section 条目（order 排序，平序保留注册顺序）。 */
				function sortedEntries() {
					var entries;
					try {
						entries = slots.entries('settings.section');
					} catch (err) {
						void err; // slots 面异常（如非框架语境）：按空处理，不污染右键默认行为。
						return [];
					}
					return (entries || []).slice().sort(function (a, b) {
						return ((a && a.options && a.options.order) || 0) - ((b && b.options && b.options.order) || 0);
					});
				}

				/** 条目显示文本：label 解析（thunk 按当前语言求值），undefined 回退 id。 */
				function labelOf(entry) {
					var options = entry.options || {};
					var label;
					try {
						label = resolveSlotLabel(options.label);
					} catch (err) {
						void err;
						label = undefined;
					}
					return (typeof label === 'string' && label) || options.id;
				}

				/** 压缩空白后的文本（DOM 文本与 label 文本都归一到该口径再比较）。 */
				function squash(text) {
					return (text || '').replace(/\s+/g, '');
				}

				/** nav 下各按钮的分区文本：读按钮内最后一个 <span>（SettingsRoot 的 label 座）。 */
				function buttonLabels(nav) {
					var out = [];
					var buttons = nav.querySelectorAll('button');
					for (var i = 0; i < buttons.length; i++) {
						var spans = buttons[i].querySelectorAll('span');
						if (spans.length) out.push(squash(spans[spans.length - 1].textContent));
					}
					return out;
				}

				/** 多重集相等（数量相等且文本全部命中，与顺序无关）。 */
				function multisetEqual(a, b) {
					var pool = b.slice();
					for (var i = 0; i < a.length; i++) {
						var j = pool.indexOf(a[i]);
						if (j === -1) return false;
						pool.splice(j, 1);
					}
					return pool.length === 0;
				}

				/**
				 * 判定一个 <nav> 是不是设置分区导航：nav 内按钮文本集合与
				 * 当前 entries 的 label 集合多重集相等。任一前提缺失 → false
				 * （静默降级，不影响默认右键行为）。
				 */
				function isSettingsNav(nav) {
					if (!nav || typeof nav.querySelectorAll !== 'function') return false;
					var entries = sortedEntries();
					if (!entries.length) return false;
					var navLabels = buttonLabels(nav);
					var entryLabels = [];
					for (var i = 0; i < entries.length; i++) entryLabels.push(squash(labelOf(entries[i])));
					return navLabels.length === entryLabels.length && multisetEqual(navLabels, entryLabels);
				}

				function findSettingsNavs() {
					var out = [];
					var navs = document.querySelectorAll('nav');
					for (var i = 0; i < navs.length; i++) if (isSettingsNav(navs[i])) out.push(navs[i]);
					return out;
				}

				/**
				 * display:none 应用器（对单个 nav）：
				 * ① 文本匹配为主——按钮 span 文本与某条目的 label 压缩相等 → 以该条目为准；
				 * ② index 兜底——未被文本命中的条目按排序下标对齐未被文本命中的按钮
				 * （label 重复 / 缺文本时仍可靠）。
				 * 只写 style.display（'none' / ''），不碰其它属性。
				 */
				function applyToNav(nav) {
					var entries = sortedEntries();
					if (!entries.length) return;
					var wanted = entries.map(function (e) {
						return squash(labelOf(e));
					});
					var textMatched = [];
					for (var i = 0; i < entries.length; i++) textMatched.push(false);
					var btns = Array.prototype.slice.call(nav.querySelectorAll('button'));
					var btnTextMatched = [];
					for (var b = 0; b < btns.length; b++) {
						var span = btns[b].querySelectorAll('span');
						var text = span.length ? squash(span[span.length - 1].textContent) : '';
						var matched = -1;
						for (var i2 = 0; i2 < entries.length; i2++) {
							if (!textMatched[i2] && wanted[i2] === text) { matched = i2; break; }
						}
						btnTextMatched.push(matched);
						if (matched !== -1) textMatched[matched] = true;
					}
					var unmappedEntries = [];
					for (var u = 0; u < entries.length; u++) if (!textMatched[u]) unmappedEntries.push(u);
					var unmappedButtons = [];
					for (var ub = 0; ub < btns.length; ub++) if (btnTextMatched[ub] === -1) unmappedButtons.push(ub);
					var indexMap = {};
					for (var k = 0; k < Math.min(unmappedEntries.length, unmappedButtons.length); k++) {
						indexMap[unmappedButtons[k]] = unmappedEntries[k];
					}
					for (var out = 0; out < btns.length; out++) {
						var idx = btnTextMatched[out] !== -1 ? btnTextMatched[out] : indexMap[out];
						if (idx === undefined) continue; // 与任何条目都对不上（如标题区混入的按钮）：不动。
						var id = entries[idx].options && entries[idx].options.id;
						btns[out].style.display = (id !== undefined && hidden.indexOf(id) !== -1) ? 'none' : '';
					}
				}

				/** 从 Host 刷新 hidden 缓存（真源永远是 Host 文件），并按当前 entries 校准（剔除已不存在的 id）。 */
				async function syncHiddenFromHost() {
					// 本地写是 fire-and-forget，POST 可能尚未落盘；紧随的重放若发 GET
					// 会读到旧值、覆盖乐观缓存，把刚隐藏的行「恢复为可见」且此后无新
					// 触发源。故 localDirty 时跳过本次 GET、保留本地缓存，并消费置 false。
					if (localDirty) { localDirty = false; return; }
					try {
						var entries = sortedEntries();
						var validIds = [];
						for (var i = 0; i < entries.length; i++) {
							var id = entries[i].options && entries[i].options.id;
							if (id !== undefined) validIds.push(id);
						}
						hidden = (await readHidden()).filter(function (h) { return validIds.indexOf(h) !== -1; });
					} catch (err) {
						void err;
					}
				}

				/** 对当前 DOM 中全部设置分区导航应用 display:none；返回命中的 nav 数量。 */
				function applyToAllNavs() {
					var navs = findSettingsNavs();
					for (var i = 0; i < navs.length; i++) applyToNav(navs[i]);
					return navs.length;
				}

				/**
				 * 重放 display:none（异步）：每次重放前先从 Host 刷新 hidden。
				 * 未找到任何 nav（slot 注册时刻与 nav DOM 就绪时刻可能错开）时做一次
				 * requestAnimationFrame 延迟重放——只补一次，不循环、不轮询。
				 */
				async function replay(retried) {
					try {
						await syncHiddenFromHost();
						if (!applyToAllNavs() && !retried && typeof requestAnimationFrame === 'function') {
							requestAnimationFrame(function () {
								void replay(true);
							});
						}
					} catch (err) {
						void err; // 异常全吞：重放路径不得污染 UI。
					}
				}

				// 重放时机：分区增减（subscribe 为微任务批次的无参回调，返回 disposer）。
				var offSlots = null;
				try {
					offSlots = slots.subscribe('settings.section', function () {
						// 打开菜单时已按当前 entries 校准；未打开则直接重放。
						if (menuEl) return;
						void replay();
					});
				} catch (err) {
					void err;
					offSlots = null;
				}
				if (offSlots) cleanupFns.push(function () { offSlots(); });

				// 重放时机：语言切换 → label 重匹配（LocaleFace.subscribe 同为无参回调）。
				var offLocale = null;
				if (locale && typeof locale.subscribe === 'function') {
					try {
						offLocale = locale.subscribe(function () {
							if (menuEl) return; // 菜单打开期间：关闭时统一重放，避免行文本被中途改写。
							void replay();
						});
					} catch (err) {
						void err;
						offLocale = null;
					}
				}
				if (offLocale) cleanupFns.push(function () { offLocale(); });

				// 重放时机：nav 挂载/重建——F5 刷新后 entries 已静态注册，slots.subscribe 不再发射，
				// 且首次 replay 的 rAF 补放发生在 nav 挂载之前，由 MutationObserver 兜住「新挂载的
				// nav 未应用隐藏态」。rAF 去重（同帧多次 mutation 只处理一次）；菜单打开期间不动
				//（与 subscribe 回调口径一致）；不发 GET——只把已缓存状态补应用到新 nav
				//（真源刷新已由菜单开/关、subscribe、初始 replay 各路径负责）。
				var mo = null;
				var moRaf = 0;
				try {
					if (typeof MutationObserver === 'function') {
						mo = new MutationObserver(function () {
							if (moRaf || typeof requestAnimationFrame !== 'function') return;
							moRaf = requestAnimationFrame(function () {
								moRaf = 0;
								if (menuEl) return;
								if (!hidden.length) return;
								applyToAllNavs();
							});
						});
						mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
					}
				} catch (err) {
					void err;
					mo = null; // 创建失败：静默降级，不影响既有重放路径。
				}
				if (mo) cleanupFns.push(function () {
					mo.disconnect();
					if (moRaf) { cancelAnimationFrame(moRaf); moRaf = 0; }
				});

				function closeMenu() {
					if (!menuEl) return;
					var el = menuEl;
					var nav = lastNav;
					menuEl = null;
					lastNav = null;
					el.parentNode && el.parentNode.removeChild(el);
					document.removeEventListener('mousedown', onDocMousedown, true);
					document.removeEventListener('keydown', onDocKeydown, true);
					onDocMousedown = null;
					onDocKeydown = null;
					// 重放时机：每次右键菜单关闭后（nav 可能已被 React 重建）。
					// menuEl 已先置 null，再异步重放（重放前 readHidden 刷新）：不阻塞关闭动作。
					if (nav) void replay();
				}

				function renderMenuRows() {
					if (!menuEl) return;
					var rows = menuEl.querySelectorAll('.sm-row');
					for (var i = 0; i < rows.length; i++) {
						var id = rows[i].getAttribute('data-id');
						var check = rows[i].querySelector('.sm-check');
						if (check) {
							var on = hidden.indexOf(id) === -1;
							check.textContent = on ? '✓' : ''; // 去括号：已勾单个 ✓，未勾纯空白。
							check.classList[on ? 'add' : 'remove']('sm-on'); // 勾选 / 未勾文字色区分（纯视觉）。
						}
					}
				}

				/** 全隐藏提示动态切换：hidden 覆盖全部当前分区时显示 .sm-warn，否则隐藏。 */
				function updateWarn() {
					if (!menuEl) return;
					var warn = menuEl.querySelector('.sm-warn');
					if (!warn) return;
					var entries = sortedEntries();
					var allHidden = entries.length > 0 && entries.every(function (e) {
						return e.options && e.options.id !== undefined && hidden.indexOf(e.options.id) !== -1;
					});
					warn.style.display = allHidden ? '' : 'none';
				}

				function renderMenu(allHidden) {
					var el = document.createElement('div');
					el.className = 'sm-menu';
					var header = document.createElement('div');
					header.className = 'sm-header';
					var title = document.createElement('span');
					title.className = 'sm-title';
					title.textContent = '设置菜单';
					header.appendChild(title);
					el.appendChild(header);
					// 全隐藏提示：常驻菜单 DOM，hidden 覆盖全部当前分区时显示
					//（菜单点击不关闭、状态实时变化，由 updateWarn() 动态切换显示）。
					var warn = document.createElement('div');
					warn.className = 'sm-warn';
					warn.textContent = '当前已全部隐藏';
					warn.style.display = allHidden ? '' : 'none';
					el.appendChild(warn);
					var entries = sortedEntries();
					for (var i = 0; i < entries.length; i++) {
						(function (entry) {
							var options = entry.options || {};
							var row = document.createElement('div');
							row.className = 'sm-row';
							row.setAttribute('data-id', String(options.id));
							var check = document.createElement('span');
							check.className = 'sm-check';
							check.textContent = hidden.indexOf(options.id) === -1 ? '✓' : ''; // 去括号：已勾单个 ✓，未勾纯空白。
							if (hidden.indexOf(options.id) === -1) check.classList.add('sm-on');
							var label = document.createElement('span');
							label.className = 'sm-label';
							label.textContent = String(labelOf(entry));
							row.appendChild(check);
							row.appendChild(label);
							row.addEventListener('click', function (e) {
								e.stopPropagation();
								var id = options.id;
								var at = hidden.indexOf(id);
								if (at === -1) hidden.push(id);
								else hidden.splice(at, 1);
								localDirty = true; // 刚发生本地写：紧随的重放信任本地缓存（避免 GET 读旧值竞态）。
								void writeHidden(hidden.slice()); // 持久化到 Host（fire-and-forget，乐观更新，下次重放再同步）。
								if (lastNav) applyToNav(lastNav); // 立即生效（菜单保持打开，勾选态实时刷新）。
								renderMenuRows();
								updateWarn(); // 全隐藏提示随状态动态切换。
							});
							el.appendChild(row);
						})(entries[i]);
					}
					// 底部操作行：「显示全部」与「隐藏全部」左右并排，次级按钮外观；
					// 均不关闭菜单（菜单只在点外部 / Escape 时关闭），点击即时保存 + 应用。
					var actions = document.createElement('div');
					actions.className = 'sm-actions';
					var showAll = document.createElement('span');
					showAll.className = 'sm-action';
					showAll.textContent = '显示全部';
					showAll.addEventListener('click', function (e) {
						e.stopPropagation();
						hidden.length = 0;
						localDirty = true; // 刚发生本地写：紧随的重放信任本地缓存（避免 GET 读旧值竞态）。
						void writeHidden([]); // 「显示全部」持久化到 Host（fire-and-forget，乐观更新）。
						if (lastNav) applyToNav(lastNav);
						renderMenuRows();
						updateWarn(); // 全隐藏提示随状态动态切换。
					});
					var hideAll = document.createElement('span');
					hideAll.className = 'sm-action';
					hideAll.textContent = '隐藏全部';
					hideAll.addEventListener('click', function (e) {
						e.stopPropagation();
						var entries = sortedEntries();
						hidden.length = 0;
						for (var i = 0; i < entries.length; i++) {
							var id = entries[i].options && entries[i].options.id;
							if (id !== undefined) hidden.push(id);
						}
						localDirty = true; // 刚发生本地写：紧随的重放信任本地缓存（避免 GET 读旧值竞态）。
						void writeHidden(hidden.slice()); // 「隐藏全部」持久化到 Host（fire-and-forget，乐观更新）。
						if (lastNav) applyToNav(lastNav);
						renderMenuRows();
						updateWarn(); // 全隐藏提示随状态动态切换。
					});
					actions.appendChild(showAll);
					actions.appendChild(hideAll);
					el.appendChild(actions);
					return el;
				}

				async function openMenu(x, y) {
					try {
						var navs = findSettingsNavs();
						var nav = navs[navs.length - 1];
						var entries = sortedEntries();
						if (!nav || !entries.length) return;
						// 打开菜单时从 Host 读回并按当前 entries 校准：丢弃已不存在的 id（分区被卸载）。
						await syncHiddenFromHost();
						closeMenu(); // 幂等：清掉上一份菜单（若有）与旧监听。
						lastNav = nav;
						// 全隐藏判定：供 renderMenu 设 .sm-warn 初始显示；
						// 菜单打开后状态可实时变化，由 updateWarn() 统一重算切换。
						var allHidden = entries.length > 0 && entries.every(function (e) {
							var id = e.options && e.options.id;
							return id !== undefined && hidden.indexOf(id) !== -1;
						});
						var el = renderMenu(allHidden);
						document.body.appendChild(el);
						// 坐标跟随鼠标；超出视口时向内收回。
						var vw = window.innerWidth || document.documentElement.clientWidth;
						var vh = window.innerHeight || document.documentElement.clientHeight;
						var left = Math.max(8, Math.min(x, vw - el.offsetWidth - 8));
						var top = Math.max(8, Math.min(y, vh - el.offsetHeight - 8));
						el.style.left = left + 'px';
						el.style.top = top + 'px';
						menuEl = el;
						updateWarn(); // 初始渲染统一走 updateWarn（与点击后各调用点同一口径）。
						onDocMousedown = function (e) {
							var t = e.target;
							if (t && t.contains && !el.contains(t)) closeMenu();
						};
						onDocKeydown = function (e) {
							if (e.key === 'Escape') {
								e.preventDefault();
								e.stopPropagation(); // 拦截：不让设置面板自身的 Escape 关面板。
								closeMenu();
							}
						};
						document.addEventListener('mousedown', onDocMousedown, true);
						document.addEventListener('keydown', onDocKeydown, true);
					} catch (err) {
						void err; // 任何异常都不得污染默认右键行为。
					}
				}

				// 右键命中（capture 阶段全局）：仅当事件落在设置分区导航才接管。
				var onContextmenu = function (event) {
					try {
						var target = event.target;
						var nav = target && target.closest ? target.closest('nav') : null;
						if (!nav || !isSettingsNav(nav)) return; // 未命中：放行默认。
						event.preventDefault();
						void openMenu(event.clientX, event.clientY); // 异步：异常已在 openMenu 内自吞，不波及默认右键行为。
					} catch (err) {
						void err; // 任何异常都不得污染默认右键行为。
					}
				};
				document.addEventListener('contextmenu', onContextmenu, true);
				cleanupFns.push(function () {
					document.removeEventListener('contextmenu', onContextmenu, true);
				});
				// 首次加载兜底：subscribe 初次触发与设置 nav DOM 就绪时刻可能错开（React 异步渲染），
				// 主动 fire-and-forget 重放一次（内部对找不到 nav 的情况会自动 rAF 补放一次）。
				void replay();
				return function () {
					closeMenu();
					for (var i = cleanupFns.length - 1; i >= 0; i--) cleanupFns[i]();
				};
			}

			// 菜单皮肤（内联 <style>，唯一常驻的可见产物；样式对齐 DSH 主题：
			// 颜色 / 字体 / 间距 / 阴影全用 --dsw-alias-* / --dsw-font-family / --dsw-elevation-* 变量，
			// 亮 / 暗主题自动跟随）。
			var STYLE_ID = 'dsh-setting-manager-style';
			function ensureStyle() {
				if (typeof document === 'undefined' || !document.head) return;
				if (document.getElementById(STYLE_ID)) return;
				var css = ''
					+ '.sm-menu{position:fixed;z-index:1200;min-width:180px;width:max-content;padding:8px;'
					+ 'background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);'
					+ 'border-radius:10px;box-shadow:var(--dsw-elevation-prominent);'
					+ 'color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);'
					+ 'font-size:13px;line-height:1.4;user-select:none}'
					+ '.sm-header{display:flex;align-items:center;padding:2px 10px 6px;'
					+ 'border-bottom:1px solid var(--dsw-alias-border-l1)}'
					+ '.sm-title{color:var(--dsw-alias-label-primary);font-weight:600}'
					+ '.sm-warn{padding:5px 10px;margin:2px 0;border-radius:6px;font-weight:500;text-align:center;'
					+ 'color:var(--dsw-alias-state-warn-label);background:var(--dsw-alias-state-warn-tertiary)}'
					+ '.sm-row{display:flex;align-items:center;gap:8px;padding:5px 10px;margin:2px 0;border-radius:6px;cursor:pointer}'
					+ '.sm-row:hover{background:var(--dsw-alias-interactive-bg-hover)}'
					+ '.sm-check{width:28px;flex:none;color:var(--dsw-alias-label-dimmed);font-family:ui-monospace,monospace}'
					+ '.sm-check.sm-on{color:var(--dsw-alias-label-secondary)}'
					+ '.sm-label{white-space:nowrap}'
					+ '.sm-actions{display:flex;justify-content:center;gap:8px;margin-top:6px}'
					+ '.sm-action{display:flex;align-items:center;padding:5px 10px;border-radius:6px;'
					+ 'border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);'
					+ 'color:var(--dsw-alias-label-secondary);cursor:pointer}'
					+ '.sm-action:hover{background:var(--dsw-alias-interactive-bg-hover)}';
				var style = document.createElement('style');
				style.id = STYLE_ID;
				style.textContent = css;
				document.head.appendChild(style);
			}
			ensureStyle();

			exports.name = name;
			exports.apply = apply;
			exports.inject = ['slots', 'locale'];
			return module.exports;
		},
	});
}
