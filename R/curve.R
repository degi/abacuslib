#' Marginal abatement cost curve (legacy prototype)
#'
#' @param data
#' @param setting
#' @param width
#' @param height
#' @param elementId
#'
#' @import htmlwidgets
#'
#' @export
legacy_abacost_curve <- function(data,
                                 setting = NULL,
                                 width = NULL,
                                 height = NULL,
                                 elementId = NULL) {
  x = list(
    data = toJSON(data, force = TRUE),
    setting = toJSON(setting, force = TRUE)
  )
  # create widget
  htmlwidgets::createWidget(
    name = 'curve',
    x,
    width = width,
    height = height,
    package = 'abacuslib',
    elementId = elementId
  )
}

if (!exists("abacost_curve", mode = "function")) {
  abacost_curve <- legacy_abacost_curve
}

#' Shiny bindings for legacy curve
#'
#' @param outputId output variable to read from
#' @param width,height CSS units
#' @param expr Expression
#' @param env Environment
#' @param quoted Quoted expression
#'
#' @name curve-shiny
#' @import htmlwidgets
#'
#' @export
legacy_abacost_curve_output <- function(outputId,
                                        width = '100%',
                                        height = '400px') {
  htmlwidgets::shinyWidgetOutput(outputId, 'curve', width, height, package = 'abacuslib')
}

if (!exists("abacost_curve_output", mode = "function")) {
  abacost_curve_output <- legacy_abacost_curve_output
}
