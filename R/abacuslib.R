#' REDD Abacus chart
#'
#' a compilation of chart for REDD Abacus
#'
#' @import htmlwidgets
#'
#' @export
abacuslib <- function(data, width = NULL, height = NULL, elementId = NULL) {

  # forward options using x
  x = list(
    data = data
  )

  # create widget
  htmlwidgets::createWidget(
    name = 'abacuslib',
    x,
    width = width,
    height = height,
    package = 'abacuslib',
    elementId = elementId
  )
}

#' Shiny bindings for abacuslib
#'
#' Output and render functions for using abacuslib within Shiny
#' applications and interactive Rmd documents.
#'
#' @param outputId output variable to read from
#' @param width,height Must be a valid CSS unit (like \code{'100\%'},
#'   \code{'400px'}, \code{'auto'}) or a number, which will be coerced to a
#'   string and have \code{'px'} appended.
#' @param expr An expression that generates a abacuslib
#' @param env The environment in which to evaluate \code{expr}.
#' @param quoted Is \code{expr} a quoted expression (with \code{quote()})? This
#'   is useful if you want to save an expression in a variable.
#'
#' @name abacuslib-shiny
#'
#' @export
abacuslibOutput <- function(outputId, width = '100%', height = '400px'){
  htmlwidgets::shinyWidgetOutput(outputId, 'abacuslib', width, height, package = 'abacuslib')
}

#' @rdname abacuslib-shiny
#' @export
renderAbacuslib <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) { expr <- substitute(expr) } # force quoted
  htmlwidgets::shinyRenderWidget(expr, abacuslibOutput, env, quoted = TRUE)
}
