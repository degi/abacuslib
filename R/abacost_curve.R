# Build the validated abatement-curve widget payload.
#' Interactive Abatement Cost Curve Widget
#'
#' Creates an interactive D3-based abatement cost curve visualization in R.
#'
#' @param data A \code{data.frame} containing the curve data.
#' @param x Column name or expression for the X-axis variable (emissions). Default is \code{"x"}.
#' @param y Column name or expression for the Y-axis variable (cost per emission unit). Default is \code{"y"}.
#' @param label Column name for bar labels. Default is \code{"label"}.
#' @param legend Column name for category/grouping variable. Default is \code{"legend"}.
#' @param show_negatives Logical; whether to initially display negative emissions. Default is \code{FALSE}.
#' @param show_threshold_line Logical; whether to display the threshold cost reference line. Default is \code{FALSE}.
#' @param threshold_cost Numeric; the initial cost threshold value. Default is \code{0}.
#' @param default_color Color hex code or CSS string for bars when no legend/zonation is active. Default is \code{NULL} (uses the first color of \code{color_theme}).
#' @param bar_color Alias for \code{default_color}.
#' @param show_legend Logical; whether to display the legend. Default is \code{TRUE}.
#' @param color_theme Color palette for legend categories: \code{"rainbow"}, \code{"viridis"}, \code{"turbo"}, or \code{"cool"}. Default is \code{"rainbow"}.
#' @param y_scale Scaling mode for the Y-axis: \code{"logarithmic"}, \code{"linear"}, or \code{"square-root"}. Default is \code{"logarithmic"}.
#' @param legend_title Title for the legend box. Default is \code{"Legend"}.
#' @param x_title Title for the X-axis. Default is \code{"Emission (Mg CO2-eq)"}.
#' @param y_title Title for the Y-axis. Default is \code{"Abatement cost ($/Mg CO2-eq)"}.
#' @param font_size General/base font size for the widget (number in pixels or CSS string e.g. \code{"12px"}). Default is \code{NULL}.
#' @param axis_title_font_size Font size for both axis titles. Overrides \code{font_size}. Default is \code{NULL}.
#' @param axis_tick_font_size Font size for both axis tick labels. Overrides \code{font_size}. Default is \code{NULL}.
#' @param x_title_font_size Font size for the X-axis title. Default is \code{NULL}.
#' @param y_title_font_size Font size for the Y-axis title. Default is \code{NULL}.
#' @param x_tick_font_size Font size for X-axis tick labels. Default is \code{NULL}.
#' @param y_tick_font_size Font size for Y-axis tick labels. Default is \code{NULL}.
#' @param legend_title_font_size Font size for the legend title. Default is \code{NULL}.
#' @param legend_text_font_size Font size for the legend category labels. Default is \code{NULL}.
#' @param annotation_font_size Font size for annotation balloon text. Default is \code{NULL}.
#' @param tooltip_font_size Font size for hover tooltip text. Default is \code{NULL}.
#' @param threshold_text_font_size Font size for threshold summary text. Default is \code{NULL}.
#' @param show_reference_line Deprecated alias for \code{show_threshold_line}.
#' @param reference_cost Deprecated alias for \code{threshold_cost}.
#' @param reference_text_font_size Deprecated alias for \code{threshold_text_font_size}.
#' @param width Widget width in CSS units or pixels. Default is \code{NULL} (responsive).
#' @param height Widget height in CSS units or pixels. Default is \code{NULL}.
#' @param elementId Explicit HTML element ID for the widget container.
#'
#' @return An \code{htmlwidget} object that can be rendered in the R console,
#'   RStudio Viewer, R Markdown / Quarto documents, or Shiny applications.
#'
#' @examples
#' if (interactive()) {
#'   # Load example data (no need for data())
#'   df <- curve_data()
#'   abacost_curve(df)
#' }
#'
#' @import htmlwidgets
#' @export
abacost_curve <- function(data,
                          x = "x",
                          y = "y",
                          label = "label",
                          legend = "legend",
                          show_negatives = FALSE,
                          show_threshold_line = FALSE,
                          threshold_cost = 0,
                          default_color = NULL,
                          bar_color = NULL,
                          show_legend = TRUE,
                          color_theme = c("rainbow", "viridis", "turbo", "cool"),
                          y_scale = c("logarithmic", "linear", "square-root"),
                          legend_title = "Legend",
                          x_title = "Emission (Mg CO2-eq)",
                          y_title = "Abatement cost ($/Mg CO2-eq)",
                          font_size = NULL,
                          axis_title_font_size = NULL,
                          axis_tick_font_size = NULL,
                          x_title_font_size = NULL,
                          y_title_font_size = NULL,
                          x_tick_font_size = NULL,
                          y_tick_font_size = NULL,
                          legend_title_font_size = NULL,
                          legend_text_font_size = NULL,
                          annotation_font_size = NULL,
                          tooltip_font_size = NULL,
                          threshold_text_font_size = NULL,
                          show_reference_line = NULL,
                          reference_cost = NULL,
                          reference_text_font_size = NULL,
                          width = NULL,
                          height = NULL,
                          elementId = NULL) {

  # Apply deprecated option aliases before validating inputs.
  if (!is.data.frame(data)) {
    stop("'data' must be a data.frame or tibble.", call. = FALSE)
  }

  if (!is.null(show_reference_line)) {
    show_threshold_line <- show_reference_line
  }
  if (!is.null(reference_cost)) {
    threshold_cost <- reference_cost
  }
  if (!is.null(reference_text_font_size)) {
    threshold_text_font_size <- reference_text_font_size
  }

  if (!is.null(bar_color) && is.null(default_color)) {
    default_color <- bar_color
  }

  req_cols <- c(x = x, y = y, label = label, legend = legend)
  missing_cols <- req_cols[!req_cols %in% names(data)]
  if (length(missing_cols) > 0) {
    stop(paste("Columns not found in data:", paste(missing_cols, collapse = ", ")), call. = FALSE)
  }

  color_theme <- match.arg(color_theme)
  y_scale <- match.arg(y_scale)

  # Normalize the requested columns and discard invalid observations.
  clean_df <- data.frame(
    label = as.character(data[[label]]),
    legend = as.character(data[[legend]]),
    x = as.numeric(data[[x]]),
    y = as.numeric(data[[y]]),
    stringsAsFactors = FALSE
  )

  valid_rows <- !is.na(clean_df$x) & !is.na(clean_df$y) & clean_df$x != 0
  if (!all(valid_rows)) {
    clean_df <- clean_df[valid_rows, , drop = FALSE]
  }

  # Order by y (cost) ascending, then by absolute bar width (abs(x)) ascending for tied y values
  if (nrow(clean_df) > 0) {
    ord <- order(clean_df$y, abs(clean_df$x))
    clean_df <- clean_df[ord, , drop = FALSE]
  }

  norm_fs <- function(val) {
    if (is.null(val) || length(val) == 0 || is.na(val) || !nzchar(as.character(val))) return(NULL)
    if (is.numeric(val)) return(paste0(val, "px"))
    as.character(val)
  }

  # Resolve base and per-element font sizes for the browser renderer.
  base_fs <- norm_fs(font_size)
  ax_title_fs <- norm_fs(axis_title_font_size)
  ax_tick_fs <- norm_fs(axis_tick_font_size)

  coalesce_val <- function(...) {
    for (v in list(...)) {
      if (!is.null(v)) return(v)
    }
    NULL
  }

  # Package curve data and display options for htmlwidgets.
  payload <- list(
    data = clean_df,
    options = list(
      show_negatives = isTRUE(show_negatives),
      show_threshold_line = isTRUE(show_threshold_line),
      threshold_cost = as.numeric(threshold_cost),
      show_reference_line = isTRUE(show_threshold_line),
      reference_cost = as.numeric(threshold_cost),
      default_color = if (!is.null(default_color) && nzchar(as.character(default_color))) as.character(default_color) else NULL,
      bar_color = if (!is.null(default_color) && nzchar(as.character(default_color))) as.character(default_color) else NULL,
      show_legend = isTRUE(show_legend),
      color_theme = color_theme,
      y_scale = y_scale,
      legend_title = as.character(legend_title),
      x_title = as.character(x_title),
      y_title = as.character(y_title),
      font_size = base_fs,
      x_title_font_size = coalesce_val(norm_fs(x_title_font_size), ax_title_fs, base_fs),
      y_title_font_size = coalesce_val(norm_fs(y_title_font_size), ax_title_fs, base_fs),
      x_tick_font_size = coalesce_val(norm_fs(x_tick_font_size), ax_tick_fs),
      y_tick_font_size = coalesce_val(norm_fs(y_tick_font_size), ax_tick_fs),
      legend_title_font_size = coalesce_val(norm_fs(legend_title_font_size), base_fs),
      legend_text_font_size = coalesce_val(norm_fs(legend_text_font_size)),
      annotation_font_size = coalesce_val(norm_fs(annotation_font_size), base_fs),
      tooltip_font_size = coalesce_val(norm_fs(tooltip_font_size), base_fs),
      threshold_text_font_size = coalesce_val(norm_fs(threshold_text_font_size), norm_fs(reference_text_font_size), base_fs),
      reference_text_font_size = coalesce_val(norm_fs(threshold_text_font_size), norm_fs(reference_text_font_size), base_fs)
    )
  )

  htmlwidgets::createWidget(
    name = "abacost_curve",
    x = payload,
    width = width,
    height = height,
    package = "abacuslib",
    elementId = elementId
  )
}

#' @rdname abacost_curve
#' @export
abacostCurve <- abacost_curve

# Shiny output and render bindings for abacost_curve.
#' Shiny bindings for abacost_curve
#'
#' Output and render functions for using \code{abacost_curve} within Shiny
#' applications and interactive R Markdown / Quarto documents.
#'
#' @param outputId Output variable name to read from.
#' @param width,height Valid CSS unit (e.g. \code{"100\%"}, \code{"550px"}) or number in pixels.
#' @param expr An expression that generates an \code{abacost_curve} widget.
#' @param env The environment in which to evaluate \code{expr}.
#' @param quoted Logical; is \code{expr} a quoted expression?
#'
#' @name abacost_curve-shiny
#' @export
abacostCurveOutput <- function(outputId, width = "100%", height = "550px") {
  htmlwidgets::shinyWidgetOutput(outputId, "abacost_curve", width, height, package = "abacuslib")
}

#' @rdname abacost_curve-shiny
#' @export
renderAbacostCurve <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) { expr <- substitute(expr) }
  htmlwidgets::shinyRenderWidget(expr, abacostCurveOutput, env, quoted = TRUE)
}

#' @rdname abacost_curve-shiny
#' @export
abacost_curveOutput <- abacostCurveOutput

#' @rdname abacost_curve-shiny
#' @export
renderAbacost_curve <- renderAbacostCurve
