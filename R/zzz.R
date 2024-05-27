# library(shiny)
# library(reshape2)

# jslist_to_df <- function(x, session, inputname) {
#   sc <- dcast(melt(x$scenario), L1 ~ L2)
#   sc$L1 = NULL
#   x$scenario <- sc
#   pj <- dcast(melt(x$projection), L1 ~ L2)
#   pj$L1 = NULL
#   x$projection <- pj
#   return(x)
# }
# 
# .onLoad <- function(libname, pkgname){
#   registerInputHandler("js_to_df", jslist_to_df)
# }
