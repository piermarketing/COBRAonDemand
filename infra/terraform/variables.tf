variable "project_id" { type = string }
variable "env" {
  type = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.env)
    error_message = "env must be dev, staging or prod."
  }
}
variable "region" {
  type    = string
  default = "us-west1"
}
variable "root_domain" {
  type    = string
  default = "cobraondemand.com"
}
variable "db_tier" {
  type    = string
  default = "db-custom-1-3840"
}
variable "vpc_network" {
  type        = string
  description = "Self link of the VPC that Cloud SQL and Cloud Run share."
}
variable "image_tag" {
  type    = string
  default = "latest"
}
