/**
 * HTMLWidgets binding for the Abacost Marginal Abatement Cost (MAC) Curve.
 * Visualizes mitigation options ordered by cost effectiveness with interactive
 * threshold analysis, annotations, and customizable scales.
 */
HTMLWidgets.widget({
  name: 'abacost_curve',
  type: 'output',

  /**
   * Factory function that initializes the widget instance and D3 container.
   * @param {HTMLElement} el - The DOM element containing the widget.
   * @param {number} width - Initial container width.
   * @param {number} height - Initial container height.
   * @returns {Object} Widget instance with renderValue and resize methods.
   */
  factory: function(el, width, height) {
    const root = d3.select(el);
    root.classed('abacost_curve', true);
    root.style('position', 'relative');
    root.html('');

    // Scoped chart container
    const chartContainer = root.append('div')
      .attr('class', 'abacost-chart')
      .style('width', '100%')
      .style('max-width', 'none');

    // Scoped contextual annotation popup menu
    const popupMenu = root.append('div')
      .attr('class', 'abacost-annotation-popup')
      .style('position', 'absolute')
      .style('display', 'none')
      .style('z-index', '999999');

    popupMenu.on('click', (event) => {
      event.stopPropagation();
    });

    // Scoped tooltip
    const tooltip = root.append('div')
      .attr('class', 'abacost-tooltip')
      .style('position', 'absolute')
      .style('display', 'none')
      .style('pointer-events', 'none')
      .style('background', 'rgba(15, 23, 42, 0.92)')
      .style('color', '#ffffff')
      .style('padding', '8px 12px')
      .style('border-radius', '6px')
      .style('font-size', '12px')
      .style('line-height', '1.45')
      .style('box-shadow', '0 8px 20px rgba(0, 0, 0, 0.35)')
      .style('border', '1px solid rgba(255, 255, 255, 0.15)')
      .style('white-space', 'normal')
      .style('z-index', '99999');

    const errorMsg = root.append('div').attr('class', 'abacost-error-msg');

    // Unique arrow marker id to prevent collision between multiple widgets
    const arrowMarkerId = 'annotation-arrow-' + Math.random().toString(36).slice(2, 9);

    // State
    let curveData = [];
    let currentOptions = {};
    let currentChart = null;
    let clickedBar = null;
    let preservedSelectedBarName = null;
    let preservedAnnotationBarNames = new Set();
    const annotationsByBar = new Map();

    /**
     * Computes a deterministic string key for a bar to track selection and annotations across renders.
     * @param {Object} d - Bar data point.
     * @returns {string|null} Composite key string or null.
     */
    const getBarKey = (d) => {
      if (!d) return null;
      return [
        String(d.label ?? ''),
        String(d.legend ?? ''),
        Number(d.x ?? 0).toFixed(10),
        Number(d.y ?? 0).toFixed(10),
        String(d.side ?? '')
      ].join('|');
    };

    /**
     * Positions the hover tooltip relative to the mouse pointer within container boundaries.
     * @param {MouseEvent|PointerEvent} event - The triggering pointer event.
     */
    const updateTooltipPosition = (event) => {
      const [pointerX, pointerY] = d3.pointer(event, el);
      const elWidth = el.clientWidth || 960;
      const left = (pointerX + 220 > elWidth) ? Math.max(10, pointerX - 210) : (pointerX + 14);
      const top = (pointerY - 45 < 0) ? (pointerY + 18) : (pointerY - 32);
      tooltip
        .style('left', left + 'px')
        .style('top', top + 'px');
    };

    /**
     * Main rendering pipeline for the MAC curve visualization.
     * Computes geometry, scales, axes, bars, reference lines, drag handlers, and legends.
     */
    function renderChart() {
      if (!curveData || curveData.length === 0) return;

      const yScaleType = currentOptions.y_scale || 'logarithmic';
      const showReferenceLine = currentOptions.show_threshold_line !== undefined
        ? Boolean(currentOptions.show_threshold_line)
        : Boolean(currentOptions.show_reference_line);

      const rawThresholdCost = currentOptions.threshold_cost !== undefined
        ? currentOptions.threshold_cost
        : currentOptions.reference_cost;
      const referenceValue = Number.isFinite(Number(rawThresholdCost))
        ? Number(rawThresholdCost)
        : 0;

      const hasLegendColumn = Array.isArray(curveData) &&
        curveData.every(record => record && Object.prototype.hasOwnProperty.call(record, 'legend'));

      const showNegative = Boolean(currentOptions.show_negatives);
      const showLegend = currentOptions.show_legend !== undefined ? Boolean(currentOptions.show_legend) : true;
      const legendTitle = currentOptions.legend_title || 'Legend';
      const colorTheme = currentOptions.color_theme || 'rainbow';
      const xAxisTitle = currentOptions.x_title || 'Emission (Mg CO2-eq)';
      const yAxisTitle = currentOptions.y_title || 'Abatement cost ($/Mg CO2-eq)';

      /**
       * Normalizes font size values into standard CSS pixel strings.
       * @param {number|string} val - Font size input.
       * @param {string} defaultVal - Fallback default font size.
       * @returns {string} CSS font size string.
       */
      const formatFontSize = (val, defaultVal) => {
        if (val === undefined || val === null || val === '') return defaultVal;
        return typeof val === 'number' ? `${val}px` : String(val);
      };

      const baseFontSize = formatFontSize(currentOptions.font_size, '12px');
      const baseNum = parseFloat(baseFontSize) || 12;
      const fontSizes = {
        base: baseFontSize,
        xTitle: formatFontSize(currentOptions.x_title_font_size, baseFontSize),
        yTitle: formatFontSize(currentOptions.y_title_font_size, baseFontSize),
        xTick: formatFontSize(currentOptions.x_tick_font_size, `${Math.max(8, Math.round(baseNum * 0.85))}px`),
        yTick: formatFontSize(currentOptions.y_tick_font_size, `${Math.max(8, Math.round(baseNum * 0.85))}px`),
        legendTitle: formatFontSize(currentOptions.legend_title_font_size, baseFontSize),
        legendText: formatFontSize(currentOptions.legend_text_font_size, `${Math.max(8, Math.round(baseNum * 0.9))}px`),
        annotation: formatFontSize(currentOptions.annotation_font_size, baseFontSize),
        tooltip: formatFontSize(currentOptions.tooltip_font_size, baseFontSize),
        referenceText: formatFontSize(
          currentOptions.threshold_text_font_size || currentOptions.reference_text_font_size,
          baseFontSize
        )
      };

      /**
       * Formats emission numeric values with 2 decimal places.
       * @param {number} val - Emission value in Mg CO2-eq.
       * @returns {string} Formatted number string.
       */
      const formatEmission = (val) => {
        const num = Number(val);
        if (!Number.isFinite(num)) return '';
        return num.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
      };

      /**
       * Formats cost numeric values with 2 decimal places.
       * @param {number} val - Abatement cost in $/Mg CO2-eq.
       * @returns {string} Formatted number string.
       */
      const formatCost = (val) => {
        const num = Number(val);
        if (!Number.isFinite(num)) return '';
        return num.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
      };

      // 1. Data Transformation
      const positiveX = curveData.filter((d) => d.x > 0);
      const negativeX = curveData.filter((d) => d.x < 0);

      /**
       * Comparator sorting bars primarily by Y (cost) ascending,
       * and secondarily by bar width (absolute emission |x|) ascending for equal Y values.
       * @param {Object} a - First bar data object.
       * @param {Object} b - Second bar data object.
       * @returns {number} Comparison result.
       */
      const sortBarsByCostThenWidth = (a, b) => {
        const EPSILON = 1e-9;
        if (Math.abs(a.y - b.y) > EPSILON) {
          return a.y - b.y;
        }
        const widthA = Math.abs(a.x);
        const widthB = Math.abs(b.x);
        if (Math.abs(widthA - widthB) > EPSILON) {
          return widthA - widthB;
        }
        return String(a.label || '').localeCompare(String(b.label || ''));
      };

      const positiveXSorted = [...positiveX].sort(sortBarsByCostThenWidth);
      const negativeXSorted = [...negativeX].sort(sortBarsByCostThenWidth);

      let cum = 0;
      const positiveBars = positiveXSorted.map((d) => {
        const x0 = cum;
        cum += d.x;
        return { ...d, x0, x1: cum, side: 'positive x' };
      });

      let cumNeg = 0;
      const negativeBarsReversed = negativeXSorted.map((d) => {
        const w = Math.abs(d.x);
        const x0 = cumNeg;
        cumNeg += w;
        return { ...d, x0: -x0, x1: -cumNeg, side: 'negative x' };
      });

      const barData2 = [...positiveBars, ...negativeBarsReversed];
      const filteredBarData = showNegative
        ? barData2
        : barData2.filter((d) => d.side !== 'negative x');

      // 2. Dimensions & Margins
      const containerWidth = chartContainer.node() ? chartContainer.node().clientWidth || 1100 : 1100;
      const chartWidth = Math.max(containerWidth, 600);
      const chartHeight = Math.max(el.clientHeight, 300);
      const legendVisible = hasLegendColumn && showLegend;
      const xTitleSize = parseFloat(fontSizes.xTitle) || 12;
      const xTickSize = parseFloat(fontSizes.xTick) || 10;
      const margin = {
        top: 60,
        right: legendVisible ? 220 : 100,
        bottom: Math.max(50, Math.round(28 + xTickSize + xTitleSize)),
        left: 60
      };

      chartContainer.selectAll('*').remove();

      const svg = chartContainer
        .append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('viewBox', `0 0 ${chartWidth} ${chartHeight}`)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('xmlns', 'http://www.w3.org/2000/svg');

      currentChart = { svg, filteredBarData };

      svg.append('defs')
        .append('marker')
        .attr('id', arrowMarkerId)
        .attr('viewBox', '0 0 10 10')
        .attr('refX', 8)
        .attr('refY', 5)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto-start-reverse')
        .append('path')
        .attr('d', 'M 0 0 L 10 5 L 0 10 z')
        .attr('fill', '#222');

      // 3. Scales
      const xExtent = d3.extent([
        ...filteredBarData.map(d => d.x0),
        ...filteredBarData.map(d => d.x1),
        0
      ]);
      const xScale = d3.scaleLinear()
        .domain(xExtent)
        .range([margin.left, chartWidth - margin.right])
        .nice();

      const yMin = d3.min(filteredBarData, d => d.y);
      const yMax = d3.max(filteredBarData, d => d.y);

      const nonZeroYValues = filteredBarData
        .map(d => Math.abs(d.y))
        .filter(value => value > 0);
      const exponentMin = nonZeroYValues.length
        ? Math.floor(Math.log10(d3.min(nonZeroYValues)))
        : 0;
      const exponentMax = Math.floor(Math.log10(Math.max(Math.abs(yMin), Math.abs(yMax)) || 1));

      // Set constant to 10^exponentMin / 9 so distance(0, 10^exponentMin) is equal to distance between decade ticks
      const symlogConstant = (10 ** exponentMin) / 9;

      const yScale = (yScaleType === 'linear'
        ? d3.scaleLinear()
        : yScaleType === 'square-root'
          ? d3.scaleSqrt()
          : d3.scaleSymlog().constant(symlogConstant))
        .domain([yMin, yMax])
        .range([chartHeight - margin.bottom, margin.top]);

      const yTickValues = yScaleType === 'logarithmic'
        ? [0, ...d3.range(exponentMin, exponentMax + 1)
          .flatMap(exponent => [-(10 ** exponent), 10 ** exponent])]
          .filter(value => value >= yMin && value <= yMax)
          .sort((a, b) => a - b)
        : yScale.ticks(6);

      const categories = hasLegendColumn
        ? Array.from(new Set(curveData.map(d => d.legend))).sort((first, second) => {
          const firstNumber = Number(first);
          const secondNumber = Number(second);
          if (Number.isFinite(firstNumber) && Number.isFinite(secondNumber)) {
            return firstNumber - secondNumber;
          }
          return String(first).localeCompare(String(second), undefined, {
            numeric: true,
            sensitivity: 'base'
          });
        })
        : [];

      const colorInterpolator = {
        rainbow: d3.interpolateRainbow,
        viridis: d3.interpolateViridis,
        turbo: d3.interpolateTurbo,
        cool: d3.interpolateCool
      }[colorTheme] || d3.interpolateRainbow;

      const defaultBarColor = currentOptions.default_color || currentOptions.bar_color || null;
      const singleColor = defaultBarColor || (colorTheme === "viridis" ? "#21918c" : colorInterpolator(0.3)) || "#2b8cbe";

      const colorScale = hasLegendColumn
        ? d3.scaleOrdinal()
          .domain(categories)
          .range(categories.length > 1 ? d3.quantize(colorInterpolator, categories.length) : [singleColor])
        : null;

      const legend = svg.append('g')
        .attr('class', 'chart-legend')
        .attr('transform', `translate(${chartWidth - margin.right + 20},${margin.top})`);
      legend.append('text')
        .attr('class', 'legend-title')
        .attr('font-weight', 'bold')
        .style('font-size', fontSizes.legendTitle)
        .text(legendTitle);

      const parsedLegTextSize = parseFloat(fontSizes.legendText) || 11;
      const legRowHeight = Math.max(16, Math.round(parsedLegTextSize * 1.5));
      const legendRows = Math.max(1, Math.floor((chartHeight - margin.top - margin.bottom - 20) / legRowHeight));
      const legendColumnWidth = 90;
      const legendItems = legend.selectAll('g')
        .data(categories)
        .join('g')
        .attr('transform', (_, index) => {
          const column = Math.floor(index / legendRows);
          const row = index % legendRows;
          return `translate(${column * legendColumnWidth},${18 + row * legRowHeight})`;
        });
      legendItems.append('rect')
        .attr('width', 12)
        .attr('height', 12)
        .attr('fill', category => colorScale(category));
      legendItems.append('text')
        .attr('class', 'legend-item-text')
        .attr('x', 18)
        .attr('y', Math.round(parsedLegTextSize * 0.9))
        .style('font-size', fontSizes.legendText)
        .text(category => category);

      legend.style('display', legendVisible ? null : 'none');

      // 4. Axes & Gridlines
      const xAxis = d3.axisBottom(xScale).tickFormat(d3.format('~s'));
      /**
       * Formats logarithmic tick values using scientific exponent notation.
       * @param {number} value - Axis tick numeric value.
       * @returns {string} Formatted exponential string.
       */
      const formatPowerOfTen = (value) => {
        if (value === 0) return '0';
        const exponent = Math.round(Math.log10(Math.abs(value)));
        return `${value < 0 ? '-' : ''}10^${exponent}`;
      };
      const yAxis = d3.axisLeft(yScale)
        .tickValues(yTickValues)
        .tickFormat(value => yScaleType === 'logarithmic'
          ? value === 0 ? '0' : formatPowerOfTen(value)
          : d3.format('~g')(value));

      svg.append('g')
        .attr('class', 'grid')
        .attr('transform', `translate(${margin.left},0)`)
        .call(d3.axisLeft(yScale)
          .tickValues(yTickValues)
          .tickSize(-chartWidth + margin.left + margin.right)
          .tickFormat('')
        )
        .call(g => g.selectAll('.tick line')
          .attr('stroke', '#e0e0e0')
          .attr('stroke-dasharray', '2,2')
        );

      // X Axis
      const xAxisG = svg.append('g')
        .attr('class', 'x-axis')
        .attr('transform', `translate(0,${chartHeight - margin.bottom})`)
        .call(xAxis);

      xAxisG.selectAll('.tick text')
        .style('font-size', fontSizes.xTick);

      xAxisG.append('text')
        .attr('class', 'x-axis-title')
        .attr('x', chartWidth - margin.right)
        .attr('y', Math.max(35, Math.round(18 + xTitleSize)))
        .attr('fill', 'black')
        .attr('text-anchor', 'end')
        .style('font-size', fontSizes.xTitle)
        .text(xAxisTitle);

      // Y Axis
      const yAxisG = svg.append('g')
        .attr('class', 'y-axis')
        .attr('transform', `translate(${margin.left},0)`)
        .call(yAxis);

      yAxisG.selectAll('.tick text')
        .style('font-size', fontSizes.yTick);

      yAxisG.call(g => g.select('.domain')
          .attr('d', `M-6,${chartHeight - margin.bottom}H0V${margin.top}`)
        )
        .append('text')
          .attr('class', 'y-axis-title')
          .attr('x', -margin.left + 10)
          .attr('y', margin.top - 10)
          .attr('fill', 'black')
          .attr('text-anchor', 'start')
          .style('font-size', fontSizes.yTitle)
          .text(yAxisTitle);

      svg.selectAll('.domain').remove();

      // 5. Reference Lines & Dragging
      let bars;
      let referenceHitArea;
      let referenceResultState = null;

      const referenceResultBox = svg.append('g')
        .attr('class', 'reference-result-box')
        .style('display', 'none');

      const referenceResultRect = referenceResultBox.append('rect')
        .attr('rx', 4)
        .attr('fill', 'white')
        .attr('stroke', '#d62728')
        .attr('stroke-dasharray', '5,3');

      const referenceResult = referenceResultBox.append('text')
        .attr('text-anchor', 'end')
        .style('font-size', fontSizes.referenceText)
        .attr('fill', '#111');

      /**
       * Updates the display box showing the current cost threshold and total avoidable emissions.
       * @param {number} refVal - Current threshold cost value.
       * @param {Object} rightmostBar - Rightmost bar data item within the threshold.
       */
      const updateReferenceResult = (refVal, rightmostBar) => {
        referenceResultState = { referenceValue: refVal, rightmostBar };
        referenceResult.text(null);
        if (!rightmostBar || !showReferenceLine) {
          referenceResultBox.style('display', 'none');
          return;
        }

        referenceResultBox.style('display', null);

        const parsedRefSize = parseFloat(fontSizes.referenceText) || 12;
        const lineSpacing = Math.round(parsedRefSize * 1.35);
        const rightX = chartWidth - margin.right - 8;
        const startY = margin.top - 34;

        referenceResult
          .attr('x', rightX)
          .attr('y', startY);

        referenceResult.append('tspan')
          .attr('x', rightX)
          .attr('dy', 0)
          .text('Cost threshold ($/Mg CO2-eq): ');
        referenceResult.append('tspan')
          .attr('font-weight', 'bold')
          .text(d3.format('.4~g')(refVal));
        referenceResult.append('tspan')
          .attr('x', rightX)
          .attr('dy', lineSpacing)
          .text('Avoidable emission (Mg CO2-eq): ');
        referenceResult.append('tspan')
          .attr('font-weight', 'bold')
          .text(formatEmission(Math.max(rightmostBar.x0, rightmostBar.x1)));

        let bbox = null;
        try {
          bbox = referenceResult.node().getBBox();
        } catch (e) {}

        const padX = 8;
        const padY = 5;

        if (bbox && bbox.width > 0 && bbox.height > 0) {
          referenceResultRect
            .attr('x', bbox.x - padX)
            .attr('y', bbox.y - padY)
            .attr('width', bbox.width + padX * 2)
            .attr('height', bbox.height + padY * 2);
        } else {
          const line1 = `Cost threshold ($/Mg CO2-eq): ${d3.format('.4~g')(refVal)}`;
          const line2 = `Avoidable emission (Mg CO2-eq): ${formatEmission(Math.max(rightmostBar.x0, rightmostBar.x1))}`;
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          ctx.font = `${parsedRefSize}px system-ui, sans-serif`;
          const textW = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width);
          const boxW = Math.ceil(textW + padX * 2);
          const boxH = Math.ceil(parsedRefSize * 2.3 + padY * 2);
          const boxX = (chartWidth - margin.right) - boxW;
          const boxY = Math.max(2, margin.top - boxH - 6);

          referenceResultRect
            .attr('x', boxX)
            .attr('y', boxY)
            .attr('width', boxW)
            .attr('height', boxH);

          referenceResult
            .attr('x', rightX)
            .attr('y', boxY + padY + parsedRefSize);
        }
      };

      /**
       * Hides the reference line tooltip.
       */
      const hideReferenceTooltip = () => tooltip.style('display', 'none');

      /**
       * Determines if an interaction event targeted the vertical reference line or hover zone.
       * @param {Event} event - Event to evaluate.
       * @returns {boolean} True if event targeted vertical reference elements.
       */
      const isVerticalReferenceEvent = (event) => {
        const target = event?.target ?? event?.sourceEvent?.target;
        return target instanceof Element && (target.closest('.vertical-reference-hover') || target.closest('.vertical-reference-line'));
      };

      /**
       * Displays the threshold cost reference line tooltip with current cost value.
       * @param {Event} event - Pointer event.
       * @param {number} [value] - Current cost threshold value.
       */
      const showReferenceTooltip = (event, value = yScale.invert(Number(referenceLine.attr('y1')))) => {
        if (isVerticalReferenceEvent(event)) return;
        tooltip
          .style('display', 'block')
          .style('background', '#d62728')
          .style('border', 'none')
          .style('box-shadow', '0 4px 12px rgba(214, 39, 40, 0.4)')
          .style('padding', '6px 10px')
          .style('font-weight', '600')
          .style('font-size', fontSizes.tooltip)
          .html(`Threshold cost line = ${d3.format('.4~g')(value)}`);
        updateTooltipPosition(event);
      };

      /**
       * Displays the tooltip over the vertical line indicating cumulative avoidable emissions.
       * @param {Event} event - Pointer event.
       */
      const showAvoidableEmissionTooltip = (event) => {
        if (!referenceResultState?.rightmostBar) {
          hideReferenceTooltip();
          return;
        }
        const avoidableEmission = formatEmission(Math.max(referenceResultState.rightmostBar.x0, referenceResultState.rightmostBar.x1));
        tooltip
          .style('display', 'block')
          .style('background', '#2ca02c')
          .style('border', 'none')
          .style('box-shadow', '0 4px 12px rgba(44, 160, 44, 0.4)')
          .style('padding', '6px 10px')
          .style('font-weight', '600')
          .style('font-size', fontSizes.tooltip)
          .html(`Avoidable emission line = ${avoidableEmission}`);
        updateTooltipPosition(event);
      };

      const verticalReferenceLine = svg.append('line')
        .attr('class', 'vertical-reference-line')
        .attr('y1', margin.top)
        .attr('y2', chartHeight - margin.bottom)
        .attr('stroke', '#2ca02c')
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '4,3')
        .style('display', 'none')
        .style('pointer-events', 'none');

      const verticalReferenceHover = svg.append('line')
        .attr('class', 'vertical-reference-hover')
        .attr('y1', margin.top)
        .attr('y2', chartHeight - margin.bottom)
        .attr('stroke', 'transparent')
        .attr('stroke-width', 14)
        .style('display', 'none')
        .style('pointer-events', 'all')
        .style('cursor', 'crosshair')
        .on('pointerenter', (event) => {
          event.stopPropagation();
          showAvoidableEmissionTooltip(event);
        })
        .on('pointermove', (event) => {
          event.stopPropagation();
          showAvoidableEmissionTooltip(event);
        })
        .on('pointerleave', (event) => {
          event.stopPropagation();
          hideReferenceTooltip();
        });

      /**
       * Handles dragging the horizontal threshold line up and down, updating avoidable emissions.
       * @param {Object} event - D3 drag event.
       */
      const handleReferenceDrag = (event) => {
        const [, pointerY] = d3.pointer(event, svg.node());
        const y = Math.max(margin.top, Math.min(chartHeight - margin.bottom, pointerY));
        referenceLine.attr('y1', y).attr('y2', y);
        referenceHitArea?.attr('y1', y).attr('y2', y);
        const newRefVal = yScale.invert(y);
        currentOptions.reference_cost = newRefVal;

        const matchingBars = filteredBarData
          .filter(d => d.y < newRefVal)
          .sort((a, b) => Math.max(b.x0, b.x1) - Math.max(a.x0, a.x1));
        const rightmostBar = matchingBars[0];

        verticalReferenceLine
          .style('display', rightmostBar && showReferenceLine ? null : 'none')
          .attr('x1', rightmostBar ? xScale(Math.max(rightmostBar.x0, rightmostBar.x1)) : null)
          .attr('x2', rightmostBar ? xScale(Math.max(rightmostBar.x0, rightmostBar.x1)) : null);
        verticalReferenceHover
          .style('display', rightmostBar && showReferenceLine ? null : 'none')
          .attr('x1', rightmostBar ? xScale(Math.max(rightmostBar.x0, rightmostBar.x1)) : null)
          .attr('x2', rightmostBar ? xScale(Math.max(rightmostBar.x0, rightmostBar.x1)) : null);
        updateReferenceResult(newRefVal, rightmostBar);
        showReferenceTooltip(event, newRefVal);

        if (typeof Shiny !== 'undefined' && typeof Shiny.setInputValue === 'function') {
          Shiny.setInputValue(el.id + '_reference_cost', newRefVal);
        }
      };

      const initialRefY = yScale(Math.max(yMin, Math.min(yMax, referenceValue)));

      referenceHitArea = svg.append('line')
        .attr('class', 'reference-line-hit-area')
        .attr('x1', margin.left)
        .attr('x2', chartWidth - margin.right)
        .attr('y1', initialRefY)
        .attr('y2', initialRefY)
        .attr('stroke', 'transparent')
        .attr('stroke-width', 16)
        .style('pointer-events', 'all')
        .style('cursor', 'ns-resize')
        .style('display', showReferenceLine ? null : 'none')
        .call(d3.drag().on('drag', handleReferenceDrag));

      const referenceLine = svg.append('line')
        .attr('class', 'reference-line')
        .attr('x1', margin.left)
        .attr('x2', chartWidth - margin.right)
        .attr('y1', initialRefY)
        .attr('y2', initialRefY)
        .attr('stroke', '#d62728')
        .attr('stroke-width', 2.5)
        .attr('stroke-dasharray', '7,4')
        .style('pointer-events', 'stroke')
        .style('cursor', 'ns-resize')
        .style('display', showReferenceLine ? null : 'none')
        .call(d3.drag().on('drag', handleReferenceDrag));

      if (showReferenceLine) {
        const initialMatching = filteredBarData
          .filter(d => d.y < referenceValue)
          .sort((a, b) => Math.max(b.x0, b.x1) - Math.max(a.x0, a.x1));
        const initialRightmost = initialMatching[0];
        verticalReferenceLine
          .style('display', initialRightmost ? null : 'none')
          .attr('x1', initialRightmost ? xScale(Math.max(initialRightmost.x0, initialRightmost.x1)) : null)
          .attr('x2', initialRightmost ? xScale(Math.max(initialRightmost.x0, initialRightmost.x1)) : null);
        verticalReferenceHover
          .style('display', initialRightmost ? null : 'none')
          .attr('x1', initialRightmost ? xScale(Math.max(initialRightmost.x0, initialRightmost.x1)) : null)
          .attr('x2', initialRightmost ? xScale(Math.max(initialRightmost.x0, initialRightmost.x1)) : null);
        updateReferenceResult(referenceValue, initialRightmost);
      }

      svg.on('mousemove', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (
          target.closest('.bar') ||
          target.closest('.vertical-reference-hover') ||
          target.closest('.vertical-reference-line') ||
          target.closest('.reference-line-hit-area') ||
          target.closest('.reference-line')
        ) {
          return;
        }
        if (!showReferenceLine) return;
        const [, pointerY] = d3.pointer(event, svg.node());
        const currentY = Number(referenceLine.attr('y1'));
        if (Math.abs(pointerY - currentY) <= 10) {
          showReferenceTooltip(event, yScale.invert(currentY));
        } else {
          hideReferenceTooltip();
        }
      }).on('mouseleave', hideReferenceTooltip);

      referenceHitArea
        .on('pointerenter', (event) => {
          showReferenceTooltip(event, yScale.invert(Number(referenceLine.attr('y1'))));
        })
        .on('pointermove', (event) => {
          showReferenceTooltip(event, yScale.invert(Number(referenceLine.attr('y1'))));
        })
        .on('pointerleave', hideReferenceTooltip);

      // Vertical baseline at x = 0
      svg.append('line')
        .attr('x1', xScale(0))
        .attr('x2', xScale(0))
        .attr('y1', margin.top)
        .attr('y2', chartHeight - margin.bottom)
        .attr('stroke', 'black')
        .attr('stroke-width', 1.5);

      // 6. Draw Bars & Annotation Logic
      /**
       * Closes the bar context action menu.
       */
      const hidePopupMenu = () => {
        popupMenu.style('display', 'none');
      };

      /**
       * Clears currently highlighted/selected bar and closes the popup menu.
       */
      const clearSelectedBar = () => {
        clickedBar = null;
        bars.classed('bar-click-selection', false);
        hidePopupMenu();
        preservedSelectedBarName = null;
      };

      /**
       * Creates or updates a persistent draggable annotation balloon anchored to the active bar.
       */
      const showAnnotation = () => {
        const selectedBar = clickedBar;
        if (!selectedBar) return;

        clickedBar = selectedBar;
        bars.classed('bar-click-selection', bar => bar === clickedBar)
          .classed('bar-hover-selection', false);

        const existingBarAnnotations = annotationsByBar.get(selectedBar) || [];
        existingBarAnnotations.forEach(({ annotation, connector }) => {
          annotation.remove();
          connector.remove();
        });
        annotationsByBar.delete(selectedBar);

        const barX = xScale((selectedBar.x0 + selectedBar.x1) / 2);
        const barY = yScale(selectedBar.y);
        const description = [
          { text: `${selectedBar.label}` },
          { text: `${legendTitle}: ${selectedBar.legend}` },
          { label: 'Emission (Mg CO2-eq)', value: formatEmission(selectedBar.x) },
          { label: 'Cost ($/Mg CO2-eq)', value: formatCost(selectedBar.y) }
        ];

        const annotFontSize = parseFloat(fontSizes.annotation) || 12;
        const annotLineHeight = Math.max(16, Math.round(annotFontSize * 1.5));
        const textMeasure = document.createElement('canvas').getContext('2d');
        textMeasure.font = `${annotFontSize}px system-ui`;
        const measurementText = description.map(entry => {
          if (entry.label) return `${entry.label}: ${entry.value}`;
          return entry.text;
        });
        const textWidth = Math.max(...measurementText.map(text => textMeasure.measureText(text).width));
        const balloonWidth = Math.ceil(textWidth + annotFontSize * 1.6);
        const balloonHeight = description.length * annotLineHeight + Math.round(annotFontSize * 1.2);
        const balloonX = Math.max(margin.left, Math.min(chartWidth - margin.right - balloonWidth, barX - balloonWidth / 2));
        const balloonY = barY > margin.top + balloonHeight + 12 ? barY - balloonHeight - 12 : barY + 12;
        const anchorY = balloonY < barY ? balloonY + balloonHeight : balloonY;

        const barLeft = Math.min(xScale(selectedBar.x0), xScale(selectedBar.x1));
        const barRight = Math.max(xScale(selectedBar.x0), xScale(selectedBar.x1));
        const barTop = Math.min(yScale(selectedBar.y), yScale(0));
        const barBottom = Math.max(yScale(selectedBar.y), yScale(0));
        /**
         * Calculates the closest anchor coordinate on a bar boundary to a given target position.
         * @param {number} targetX - Target X coordinate.
         * @param {number} targetY - Target Y coordinate.
         * @returns {{x: number, y: number}} Anchor point on the bar boundary.
         */
        const closestBarPoint = (targetX, targetY) => ({
          x: (barLeft + barRight) / 2,
          y: Math.max(barTop, Math.min(barBottom, targetY))
        });
        const initialBarPoint = closestBarPoint(balloonX + balloonWidth / 2, balloonY + balloonHeight / 2);

        const connector = svg.append('line')
          .attr('class', 'annotation-connector')
          .attr('x1', initialBarPoint.x)
          .attr('y1', initialBarPoint.y)
          .attr('x2', balloonX + balloonWidth / 2)
          .attr('y2', anchorY)
          .attr('stroke', '#222')
          .attr('stroke-width', 1)
          .attr('marker-start', `url(#${arrowMarkerId})`);

        const annotation = svg.append('g')
          .attr('class', 'annotation-balloon')
          .raise();

        let offsetX = 0;
        let offsetY = 0;
        annotation.call(d3.drag().on('drag', (event) => {
          offsetX = Math.max(
            margin.left - balloonX,
            Math.min(chartWidth - margin.right - balloonX - balloonWidth, offsetX + event.dx)
          );
          offsetY = Math.max(
            margin.top - balloonY,
            Math.min(chartHeight - margin.bottom - balloonY - balloonHeight, offsetY + event.dy)
          );
          annotation.attr('transform', `translate(${offsetX},${offsetY})`);
          const balloonCenterX = balloonX + balloonWidth / 2 + offsetX;
          const balloonCenterY = balloonY + balloonHeight / 2 + offsetY;
          const closestPoint = closestBarPoint(balloonCenterX, balloonCenterY);
          connector
            .attr('x1', closestPoint.x)
            .attr('y1', closestPoint.y)
            .attr('x2', balloonCenterX)
            .attr('y2', anchorY + offsetY);
        }));

        annotation.append('rect')
          .attr('x', balloonX)
          .attr('y', balloonY)
          .attr('width', balloonWidth)
          .attr('height', balloonHeight)
          .attr('rx', 5)
          .attr('fill', '#fff9d6')
          .attr('stroke', '#222');

        annotation.selectAll('text')
          .data(description)
          .join('text')
          .attr('x', balloonX + 10)
          .attr('y', (_, index) => balloonY + Math.round(annotFontSize * 1.2) + index * annotLineHeight)
          .style('font-size', `${annotFontSize}px`)
          .attr('fill', '#111')
          .each(function(entry) {
            const node = d3.select(this);
            node.selectAll('*').remove();
            if (entry && Object.prototype.hasOwnProperty.call(entry, 'label')) {
              node.append('tspan').text(`${entry.label}: `).attr('font-weight', '400');
              node.append('tspan').text(entry.value).attr('font-weight', '700');
            } else {
              node.text(entry.text);
            }
          });

        annotationsByBar.set(selectedBar, [{ annotation, connector }]);
        preservedAnnotationBarNames.add(getBarKey(selectedBar));
      };

      /**
       * Positions and renders the context menu when a user right-clicks or long-presses a bar.
       * @param {Object} d - Bar data item.
       * @param {MouseEvent} event - Triggering mouse event.
       */
      const updatePopupMenu = (d, event) => {
        if (!d) {
          hidePopupMenu();
          return;
        }

        tooltip.style('display', 'none');
        popupMenu.selectAll('*').remove();

        const faIcons = {
          plus: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M256 80c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 144L48 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l144 0 0 144c0 17.7 14.3 32 32 32s32-14.3 32-32l0-144 144 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-144 0 0-144z"/></svg>',
          trashCan: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M135.2 17.7C140.6 6.8 151.7 0 163.8 0L284.2 0c12.1 0 23.2 6.8 28.6 17.7L320 32l96 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 96C14.3 96 0 81.7 0 64S14.3 32 32 32l96 0 7.2-14.3zM32 128l384 0 0 320c0 35.3-28.7 64-64 64L96 512c-35.3 0-64-28.7-64-64l0-320zm96 64c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16z"/></svg>',
          broom: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M566.6 54.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-192 192-34.7-34.7c-4.2-4.2-10-6.6-16-6.6c-12.5 0-22.6 10.1-22.6 22.6l0 29.1L364.3 320l29.1 0c12.5 0 22.6-10.1 22.6-22.6c0-6-2.4-11.8-6.6-16l-34.7-34.7 192-192zM341.1 353.4L222.6 234.9c-42.7-3.7-85.2 11.7-115.8 42.3l-8 8C76.5 307.5 64 337.7 64 369.2c0 6.8 7.1 11.2 13.2 8.2l51.1-25.5c5-2.5 9.5 4.1 5.4 7.9L7.3 473.4C2.7 477.6 0 483.6 0 489.9C0 502.1 9.9 512 22.1 512l173.3 0c38.8 0 75.9-15.4 103.4-42.8c30.6-30.6 45.9-73.1 42.3-115.8z"/></svg>',
          xmark: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z"/></svg>'
        };

        // Header
        const header = popupMenu.append('div').attr('class', 'annotation-popup-header');
        header.append('span')
          .attr('class', 'annotation-popup-title')
          .text(d.label || 'Selected Bar');
        header.append('button')
          .attr('type', 'button')
          .attr('class', 'annotation-popup-close')
          .attr('aria-label', 'Close')
          .html(faIcons.xmark)
          .on('click', () => {
            clearSelectedBar();
          });

        // Actions
        const actions = popupMenu.append('div').attr('class', 'annotation-popup-actions');
        const hasAnnotation = annotationsByBar.has(d);

        if (!hasAnnotation) {
          actions.append('button')
            .attr('type', 'button')
            .attr('class', 'annotation-popup-btn btn-primary')
            .html(`${faIcons.plus} Add Annotation`)
            .on('click', () => {
              showAnnotation();
              updatePopupMenu(clickedBar);
            });
        } else {
          actions.append('button')
            .attr('type', 'button')
            .attr('class', 'annotation-popup-btn btn-danger')
            .html(`${faIcons.trashCan} Remove Annotation`)
            .on('click', () => {
              if (!clickedBar) return;
              const barAnnotations = annotationsByBar.get(clickedBar) || [];
              barAnnotations.forEach(({ annotation, connector }) => {
                annotation.remove();
                connector.remove();
              });
              annotationsByBar.delete(clickedBar);
              preservedAnnotationBarNames.delete(getBarKey(clickedBar));
              updatePopupMenu(clickedBar);
            });
        }

        if (annotationsByBar.size > 0) {
          actions.append('button')
            .attr('type', 'button')
            .attr('class', 'annotation-popup-btn')
            .html(`${faIcons.broom} Clear All`)
            .on('click', () => {
              svg.selectAll('.annotation-balloon, .annotation-connector').remove();
              annotationsByBar.clear();
              preservedAnnotationBarNames.clear();
              updatePopupMenu(clickedBar);
            });
        }

        if (event) {
          const [pointerX, pointerY] = d3.pointer(event, el);
          const elWidth = el.clientWidth || 960;
          const menuWidth = 185;
          const left = (pointerX + menuWidth + 15 > elWidth)
            ? Math.max(10, pointerX - menuWidth - 10)
            : (pointerX + 12);
          const top = Math.max(10, Math.min(chartHeight - 110, pointerY - 25));
          popupMenu
            .style('left', left + 'px')
            .style('top', top + 'px')
            .style('display', 'block');
        } else {
          popupMenu.style('display', 'block');
        }
      };

      bars = svg.selectAll('.bar')
        .data(filteredBarData)
        .join('rect')
          .attr('class', 'bar')
          .attr('x', d => Math.min(xScale(d.x0), xScale(d.x1)))
          .attr('width', d => Math.abs(xScale(d.x1) - xScale(d.x0)))
          .attr('y', d => Math.min(yScale(d.y), yScale(0)))
          .attr('height', d => Math.abs(yScale(d.y) - yScale(0)))
          .attr('fill', d => {
            if (defaultBarColor) return defaultBarColor;
            return (hasLegendColumn && colorScale && colorScale(d.legend)) ? colorScale(d.legend) : singleColor;
          })
          .on('click', (event, d) => {
            event.stopPropagation();
            tooltip.style('display', 'none');
            clickedBar = d;
            preservedSelectedBarName = getBarKey(d);
            bars.classed('bar-click-selection', bar => bar === clickedBar);
            updatePopupMenu(d, event);
          })
          .on('mouseover', (event, d) => {
            if (clickedBar === d && popupMenu.style('display') !== 'none') {
              tooltip.style('display', 'none');
              return;
            }
            bars.classed('bar-hover-selection', bar => bar === d);
            const parsedTipSize = parseFloat(fontSizes.tooltip) || 12;
            const tipTitleSize = Math.round(parsedTipSize * 1.1);
            const popupLines = [
              `<div style="font-weight: 700; font-size: ${tipTitleSize}px; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.25); padding-bottom: 2px;">${d.label}</div>`,
              `<div>${legendTitle}: <b>${d.legend}</b></div>`,
              `<div>Emission (Mg CO2-eq): <b>${formatEmission(d.x)}</b></div>`,
              `<div>Cost ($/Mg CO2-eq): <b>${formatCost(d.y)}</b></div>`
            ];
            tooltip
              .style('display', 'block')
              .style('background', 'rgba(15, 23, 42, 0.92)')
              .style('border', '1px solid rgba(255, 255, 255, 0.15)')
              .style('box-shadow', '0 8px 20px rgba(0, 0, 0, 0.35)')
              .style('padding', '8px 12px')
              .style('font-weight', 'normal')
              .style('font-size', fontSizes.tooltip)
              .html(popupLines.join(''));
            updateTooltipPosition(event);
          })
          .on('mousemove', (event, d) => {
            if (clickedBar === d && popupMenu.style('display') !== 'none') {
              tooltip.style('display', 'none');
              return;
            }
            updateTooltipPosition(event);
          })
          .on('mouseout', () => {
            bars.classed('bar-hover-selection', false);
            tooltip.style('display', 'none');
          });

      /**
       * Reconstructs saved annotation balloons after a chart re-render.
       */
      const restoreAnnotations = () => {
        const annotationKeys = Array.from(preservedAnnotationBarNames);
        if (!annotationKeys.length) return;
        annotationKeys.forEach((key) => {
          const restoredBar = filteredBarData.find(d => getBarKey(d) === key);
          if (!restoredBar || annotationsByBar.has(restoredBar)) return;
          clickedBar = restoredBar;
          showAnnotation();
        });
      };

      svg.on('click', (event) => {
        if (!event.target.closest('.bar')) {
          clearSelectedBar();
        }
      });

      root.on('click', (event) => {
        if (!event.target.closest('.bar') && !event.target.closest('.abacost-annotation-popup')) {
          clearSelectedBar();
        }
      });

      referenceLine.raise();
      referenceHitArea.raise();
      verticalReferenceLine.raise();

      if (preservedSelectedBarName) {
        const restoredBar = filteredBarData.find(d => getBarKey(d) === preservedSelectedBarName);
        if (restoredBar) {
          clickedBar = restoredBar;
          preservedSelectedBarName = getBarKey(restoredBar);
          bars.classed('bar-click-selection', bar => bar === restoredBar);
        }
      }

      restoreAnnotations();

      if (!preservedSelectedBarName && preservedAnnotationBarNames.size > 0) {
        const firstBar = filteredBarData.find(d => preservedAnnotationBarNames.has(getBarKey(d)));
        if (firstBar) {
          clickedBar = firstBar;
          preservedSelectedBarName = getBarKey(firstBar);
        }
      }
    }

    return {
      /**
       * Parses incoming data and options from htmlwidgets and initiates chart rendering.
       * @param {Object} x - Widget payload containing data and options.
       */
      renderValue: function(x) {
        if (!x || !x.data) return;

        let rawData = x.data;
        if (typeof HTMLWidgets !== 'undefined' && typeof HTMLWidgets.dataframeToD3 === 'function') {
          rawData = HTMLWidgets.dataframeToD3(rawData);
        } else if (!Array.isArray(rawData) && typeof rawData === 'object') {
          const keys = Object.keys(rawData);
          const n = keys.length && Array.isArray(rawData[keys[0]]) ? rawData[keys[0]].length : 0;
          const rows = [];
          for (let i = 0; i < n; i++) {
            const row = {};
            for (const key of keys) {
              row[key] = rawData[key][i];
            }
            rows.push(row);
          }
          rawData = rows;
        }

        curveData = (rawData || []).map(d => ({
          label: d.label !== undefined ? String(d.label) : '',
          legend: d.legend !== undefined ? String(d.legend) : '',
          x: Number(d.x),
          y: Number(d.y)
        }));

        currentOptions = Object.assign({
          show_negatives: false,
          show_threshold_line: false,
          threshold_cost: 0,
          show_reference_line: false,
          reference_cost: 0,
          show_legend: true,
          color_theme: 'rainbow',
          y_scale: 'logarithmic',
          legend_title: 'Legend',
          x_title: 'Emission (Mg CO2-eq)',
          y_title: 'Abatement cost ($/Mg CO2-eq)',
          font_size: null,
          x_title_font_size: null,
          y_title_font_size: null,
          x_tick_font_size: null,
          y_tick_font_size: null,
          legend_title_font_size: null,
          legend_text_font_size: null,
          annotation_font_size: null,
          tooltip_font_size: null,
          threshold_text_font_size: null,
          reference_text_font_size: null
        }, x.options || {});

        try {
          errorMsg.text('');
          renderChart();
        } catch (err) {
          console.error('Error rendering abacost_curve chart:', err);
          errorMsg.text('Chart rendering error: ' + err.message);
        }
      },

      /**
       * Re-renders the visualization when the container size changes.
       * @param {number} newWidth - New container width.
       * @param {number} newHeight - New container height.
       */
      resize: function(newWidth, newHeight) {
        if (curveData && curveData.length) {
          renderChart();
        }
      }
    };
  }
});