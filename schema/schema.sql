-- MySQL dump 10.13  Distrib 9.6.0, for macos26.3 (arm64)
--
-- Host: mysql-proxy-nlb-public-e151cae2a6c09403.elb.ap-south-1.amazonaws.com    Database: AJMAL
-- ------------------------------------------------------
-- Server version	8.0.42

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `discount_code_alerts`
--

DROP TABLE IF EXISTS `discount_code_alerts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `discount_code_alerts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `alert_time` datetime DEFAULT NULL,
  `brand` varchar(50) DEFAULT NULL,
  `alert_type` varchar(50) DEFAULT NULL,
  `discount_code` varchar(100) DEFAULT NULL,
  `current_share` decimal(5,2) DEFAULT NULL,
  `baseline_share` decimal(5,2) DEFAULT NULL,
  `message` text,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `discount_summary`
--

DROP TABLE IF EXISTS `discount_summary`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `discount_summary` (
  `date` date NOT NULL,
  `total_discounts_given` double NOT NULL DEFAULT '0',
  `total_discount_on_returns` double NOT NULL DEFAULT '0',
  `actual_discounts` double NOT NULL DEFAULT '0',
  PRIMARY KEY (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `discount_summary_stage`
--

DROP TABLE IF EXISTS `discount_summary_stage`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `discount_summary_stage` (
  `date` date NOT NULL,
  `total_discounts_given` double NOT NULL DEFAULT '0',
  `total_discount_on_returns` double NOT NULL DEFAULT '0',
  `actual_discounts` double NOT NULL DEFAULT '0',
  PRIMARY KEY (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `gross_summary`
--

DROP TABLE IF EXISTS `gross_summary`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `gross_summary` (
  `date` date NOT NULL,
  `overall_sale` double DEFAULT NULL,
  `shipping_total` double DEFAULT NULL,
  `discounts_total` double NOT NULL DEFAULT '0',
  `tax_total` double DEFAULT NULL,
  `gross_sales` double DEFAULT NULL,
  `actual_discounts` double NOT NULL DEFAULT '0',
  `net_sales` double DEFAULT NULL,
  PRIMARY KEY (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `gross_summary_stage`
--

DROP TABLE IF EXISTS `gross_summary_stage`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `gross_summary_stage` (
  `date` date NOT NULL,
  `overall_sale` double DEFAULT NULL,
  `shipping_total` double DEFAULT NULL,
  `discounts_total` double NOT NULL DEFAULT '0',
  `tax_total` double DEFAULT NULL,
  `gross_sales` double DEFAULT NULL,
  `actual_discounts` double NOT NULL DEFAULT '0',
  `net_sales` double DEFAULT NULL,
  PRIMARY KEY (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hour_wise_sales`
--

DROP TABLE IF EXISTS `hour_wise_sales`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hour_wise_sales` (
  `date` date DEFAULT NULL,
  `hour` int DEFAULT NULL,
  `number_of_orders` bigint NOT NULL DEFAULT '0',
  `total_sales` double DEFAULT NULL,
  `number_of_prepaid_orders` bigint NOT NULL DEFAULT '0',
  `number_of_cod_orders` bigint NOT NULL DEFAULT '0',
  `number_of_sessions` int NOT NULL DEFAULT '0',
  `number_of_atc_sessions` int NOT NULL DEFAULT '0',
  `adjusted_number_of_sessions` int DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hour_wise_sales_stage`
--

DROP TABLE IF EXISTS `hour_wise_sales_stage`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hour_wise_sales_stage` (
  `date` date NOT NULL,
  `hour` int NOT NULL,
  `number_of_orders` bigint NOT NULL DEFAULT '0',
  `total_sales` double DEFAULT NULL,
  `number_of_prepaid_orders` bigint NOT NULL DEFAULT '0',
  `number_of_cod_orders` bigint NOT NULL DEFAULT '0',
  `number_of_sessions` int NOT NULL DEFAULT '0',
  `number_of_atc_sessions` int NOT NULL DEFAULT '0',
  `adjusted_number_of_sessions` int DEFAULT NULL,
  PRIMARY KEY (`date`,`hour`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hourly_product_performance_rollup`
--

DROP TABLE IF EXISTS `hourly_product_performance_rollup`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hourly_product_performance_rollup` (
  `date` date NOT NULL,
  `hour` tinyint unsigned NOT NULL,
  `product_id` varchar(50) NOT NULL,
  `product_title` varchar(255) DEFAULT NULL,
  `sessions` int unsigned NOT NULL DEFAULT '0',
  `sessions_with_cart_additions` int unsigned NOT NULL DEFAULT '0',
  `orders` int unsigned NOT NULL DEFAULT '0',
  `units_sold` int unsigned NOT NULL DEFAULT '0',
  `total_sales` decimal(14,2) NOT NULL DEFAULT '0.00',
  `add_to_cart_rate` decimal(8,4) NOT NULL DEFAULT '0.0000',
  `cvr` decimal(8,4) NOT NULL DEFAULT '0.0000',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`date`,`hour`,`product_id`),
  KEY `idx_hpr_product_date_hour` (`product_id`,`date`,`hour`),
  KEY `idx_hpr_date_product` (`date`,`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hourly_product_sessions`
--

DROP TABLE IF EXISTS `hourly_product_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hourly_product_sessions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `date` date NOT NULL,
  `hour` tinyint unsigned NOT NULL,
  `landing_page_type` varchar(100) DEFAULT NULL,
  `landing_page_path` varchar(500) NOT NULL,
  `product_id` varchar(50) DEFAULT NULL,
  `product_title` varchar(255) DEFAULT NULL,
  `utm_source` varchar(255) DEFAULT NULL,
  `utm_medium` varchar(255) DEFAULT NULL,
  `utm_campaign` varchar(255) DEFAULT NULL,
  `utm_content` varchar(255) DEFAULT NULL,
  `utm_term` varchar(255) DEFAULT NULL,
  `referrer_name` varchar(255) DEFAULT NULL,
  `sessions` int NOT NULL DEFAULT '0',
  `sessions_with_cart_additions` int NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `landing_page_path_norm` varchar(500) GENERATED ALWAYS AS (if((`landing_page_path` = _utf8mb4'/'),_utf8mb4'/',trim(trailing _utf8mb4'/' from `landing_page_path`))) STORED,
  `dim_hash` binary(20) GENERATED ALWAYS AS (unhex(sha(concat_ws(_utf8mb4'|',`landing_page_type`,`landing_page_path`,ifnull(`utm_source`,_utf8mb4''),ifnull(`utm_medium`,_utf8mb4''),ifnull(`utm_campaign`,_utf8mb4''),ifnull(`utm_content`,_utf8mb4''),ifnull(`utm_term`,_utf8mb4''),ifnull(`referrer_name`,_utf8mb4''))))) STORED,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_date_hour_dim` (`date`,`hour`,`dim_hash`),
  KEY `idx_date_hour` (`date`,`hour`),
  KEY `idx_product_date` (`product_id`,`date`),
  KEY `idx_date_campaign` (`date`,`utm_campaign`(150)),
  KEY `idx_date_path` (`date`,`landing_page_path`(200)),
  KEY `idx_date_norm` (`date`,`landing_page_path_norm`(200)),
  KEY `idx_date_updated` (`date`,`updated_at`)
) ENGINE=InnoDB AUTO_INCREMENT=8477548 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hourly_sessions_summary`
--

DROP TABLE IF EXISTS `hourly_sessions_summary`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hourly_sessions_summary` (
  `date` date NOT NULL,
  `hour` tinyint unsigned NOT NULL,
  `number_of_sessions` int DEFAULT '0',
  `number_of_atc_sessions` int DEFAULT '0',
  `adjusted_number_of_sessions` int DEFAULT NULL,
  `desktop_sessions` int DEFAULT '0',
  `desktop_atc_sessions` int DEFAULT '0',
  `mobile_sessions` int DEFAULT '0',
  `mobile_atc_sessions` int DEFAULT '0',
  `tablet_sessions` int DEFAULT '0',
  `tablet_atc_sessions` int DEFAULT '0',
  `other_sessions` int DEFAULT '0',
  `other_atc_sessions` int DEFAULT '0',
  PRIMARY KEY (`date`,`hour`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hourly_sessions_summary_shopify`
--

DROP TABLE IF EXISTS `hourly_sessions_summary_shopify`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hourly_sessions_summary_shopify` (
  `date` date NOT NULL,
  `hour` tinyint unsigned NOT NULL,
  `number_of_sessions` int DEFAULT '0',
  `number_of_atc_sessions` int DEFAULT '0',
  `adjusted_number_of_sessions` int DEFAULT NULL,
  `desktop_sessions` int DEFAULT '0',
  `desktop_atc_sessions` int DEFAULT '0',
  `mobile_sessions` int DEFAULT '0',
  `mobile_atc_sessions` int DEFAULT '0',
  `tablet_sessions` int DEFAULT '0',
  `tablet_atc_sessions` int DEFAULT '0',
  `other_sessions` int DEFAULT '0',
  `other_atc_sessions` int DEFAULT '0',
  PRIMARY KEY (`date`,`hour`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mv_product_sessions_by_campaign_daily`
--

DROP TABLE IF EXISTS `mv_product_sessions_by_campaign_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mv_product_sessions_by_campaign_daily` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `date` date NOT NULL,
  `landing_page_path` varchar(500) NOT NULL,
  `product_id` varchar(50) DEFAULT NULL,
  `referrer_name` varchar(255) DEFAULT NULL,
  `utm_source` varchar(255) DEFAULT NULL,
  `utm_medium` varchar(255) DEFAULT NULL,
  `utm_campaign` varchar(255) DEFAULT NULL,
  `utm_content` varchar(255) DEFAULT NULL,
  `utm_term` varchar(255) DEFAULT NULL,
  `sessions` int NOT NULL DEFAULT '0',
  `sessions_with_cart_additions` int NOT NULL DEFAULT '0',
  `add_to_cart_rate` decimal(6,4) NOT NULL DEFAULT '0.0000',
  `add_to_cart_rate_pct` decimal(9,4) NOT NULL DEFAULT '0.0000',
  `orders` int NOT NULL DEFAULT '0',
  `conversion_rate_pct` decimal(9,4) NOT NULL DEFAULT '0.0000',
  PRIMARY KEY (`id`),
  KEY `idx_date` (`date`),
  KEY `idx_date_campaign` (`date`,`utm_campaign`(150)),
  KEY `idx_product_date` (`product_id`,`date`),
  KEY `idx_referrer` (`referrer_name`(100))
) ENGINE=InnoDB AUTO_INCREMENT=1607537 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mv_product_sessions_by_path_daily`
--

DROP TABLE IF EXISTS `mv_product_sessions_by_path_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mv_product_sessions_by_path_daily` (
  `date` date NOT NULL,
  `landing_page_path` varchar(500) NOT NULL,
  `product_id` varchar(50) DEFAULT NULL,
  `sessions` int NOT NULL DEFAULT '0',
  `sessions_with_cart_additions` int NOT NULL DEFAULT '0',
  `add_to_cart_rate` decimal(6,4) NOT NULL DEFAULT '0.0000',
  `add_to_cart_rate_pct` decimal(8,4) DEFAULT '0.0000',
  `conversion_rate_pct` decimal(8,4) DEFAULT '0.0000',
  PRIMARY KEY (`date`,`landing_page_path`(200)),
  KEY `idx_date` (`date`),
  KEY `idx_sessions` (`date`,`sessions` DESC),
  KEY `idx_product_id` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mv_product_sessions_by_type_daily`
--

DROP TABLE IF EXISTS `mv_product_sessions_by_type_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mv_product_sessions_by_type_daily` (
  `date` date NOT NULL,
  `landing_page_type` varchar(100) NOT NULL,
  `product_type` varchar(255) NOT NULL DEFAULT 'Unknown',
  `sessions` int NOT NULL DEFAULT '0',
  `sessions_with_cart_additions` int NOT NULL DEFAULT '0',
  `add_to_cart_rate` decimal(6,4) NOT NULL DEFAULT '0.0000',
  PRIMARY KEY (`date`,`landing_page_type`,`product_type`),
  KEY `idx_type` (`landing_page_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `order_summary`
--

DROP TABLE IF EXISTS `order_summary`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `order_summary` (
  `date` date NOT NULL,
  `number_of_orders_created` decimal(42,0) DEFAULT NULL,
  `number_of_orders_returned` decimal(42,0) DEFAULT NULL,
  `actual_number_of_orders` decimal(43,0) DEFAULT NULL,
  `cod_orders` decimal(43,0) DEFAULT NULL,
  `prepaid_orders` decimal(43,0) DEFAULT NULL,
  `partially_paid_orders` int DEFAULT '0',
  `overall_cod_orders` decimal(42,0) DEFAULT NULL,
  `overall_prepaid_orders` decimal(42,0) DEFAULT NULL,
  `overall_partially_paid_orders` int DEFAULT '0',
  PRIMARY KEY (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `order_summary_stage`
--

DROP TABLE IF EXISTS `order_summary_stage`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `order_summary_stage` (
  `date` date NOT NULL,
  `number_of_orders_created` decimal(42,0) DEFAULT NULL,
  `number_of_orders_returned` decimal(42,0) DEFAULT NULL,
  `actual_number_of_orders` decimal(43,0) DEFAULT NULL,
  `cod_orders` decimal(43,0) DEFAULT NULL,
  `prepaid_orders` decimal(43,0) DEFAULT NULL,
  `partially_paid_orders` int DEFAULT '0',
  `overall_cod_orders` decimal(42,0) DEFAULT NULL,
  `overall_prepaid_orders` decimal(42,0) DEFAULT NULL,
  `overall_partially_paid_orders` int DEFAULT '0',
  PRIMARY KEY (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `overall_referrer_summary`
--

DROP TABLE IF EXISTS `overall_referrer_summary`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `overall_referrer_summary` (
  `date` date NOT NULL,
  `referrer_name` varchar(255) NOT NULL,
  `referrer_sessions` int DEFAULT '0',
  `referrer_atc_sessions` int DEFAULT '0',
  `referrer_names` json DEFAULT NULL,
  PRIMARY KEY (`date`,`referrer_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `overall_summary`
--

DROP TABLE IF EXISTS `overall_summary`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `overall_summary` (
  `date` date NOT NULL,
  `gross_sales` double NOT NULL DEFAULT '0',
  `total_discount_amount` double NOT NULL DEFAULT '0',
  `total_sales` double NOT NULL DEFAULT '0',
  `net_sales` double NOT NULL DEFAULT '0',
  `total_orders` decimal(42,0) NOT NULL DEFAULT '0',
  `cod_orders` decimal(42,0) NOT NULL DEFAULT '0',
  `prepaid_orders` decimal(42,0) NOT NULL DEFAULT '0',
  `partially_paid_orders` int DEFAULT '0',
  `total_sessions` int NOT NULL DEFAULT '0',
  `total_atc_sessions` int NOT NULL DEFAULT '0',
  `adjusted_total_sessions` bigint DEFAULT NULL,
  PRIMARY KEY (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `overall_summary_stage`
--

DROP TABLE IF EXISTS `overall_summary_stage`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `overall_summary_stage` (
  `date` date DEFAULT NULL,
  `gross_sales` double NOT NULL DEFAULT '0',
  `total_discount_amount` double NOT NULL DEFAULT '0',
  `total_sales` double NOT NULL DEFAULT '0',
  `net_sales` double NOT NULL DEFAULT '0',
  `total_orders` decimal(42,0) NOT NULL DEFAULT '0',
  `cod_orders` decimal(42,0) NOT NULL DEFAULT '0',
  `prepaid_orders` decimal(42,0) NOT NULL DEFAULT '0',
  `partially_paid_orders` int DEFAULT '0',
  `total_sessions` int NOT NULL DEFAULT '0',
  `total_atc_sessions` int NOT NULL DEFAULT '0',
  `adjusted_total_sessions` bigint DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `overall_traffic_split`
--

DROP TABLE IF EXISTS `overall_traffic_split`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `overall_traffic_split` (
  `date` date NOT NULL,
  `utm_source` json DEFAULT NULL,
  PRIMARY KEY (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `overall_utm_summary`
--

DROP TABLE IF EXISTS `overall_utm_summary`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `overall_utm_summary` (
  `date` date NOT NULL,
  `utm_source` varchar(255) NOT NULL,
  `utm_source_sessions` int DEFAULT '0',
  `utm_source_atc_sessions` int DEFAULT '0',
  `utm_names` text,
  PRIMARY KEY (`date`,`utm_source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pipeline_metadata`
--

DROP TABLE IF EXISTS `pipeline_metadata`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pipeline_metadata` (
  `key_name` varchar(50) NOT NULL,
  `key_value` datetime DEFAULT NULL,
  PRIMARY KEY (`key_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `product_landing_mapping`
--

DROP TABLE IF EXISTS `product_landing_mapping`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `product_landing_mapping` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `product_id` bigint NOT NULL,
  `landing_page_path` varchar(500) NOT NULL,
  `status` varchar(50) DEFAULT NULL,
  `title` varchar(255) DEFAULT NULL,
  `product_type` varchar(255) DEFAULT NULL,
  `last_synced_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `landing_page_path_norm` varchar(500) GENERATED ALWAYS AS (if((`landing_page_path` = _utf8mb4'/'),_utf8mb4'/',trim(trailing _utf8mb4'/' from `landing_page_path`))) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_landing_page_path` (`landing_page_path`(200)),
  UNIQUE KEY `uniq_landing_page_path_norm` (`landing_page_path_norm`(200)),
  KEY `idx_product_id` (`product_id`),
  KEY `idx_last_synced_at` (`last_synced_at`)
) ENGINE=InnoDB AUTO_INCREMENT=1501580 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `product_landing_page_map`
--

DROP TABLE IF EXISTS `product_landing_page_map`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `product_landing_page_map` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `product_id` varchar(50) NOT NULL,
  `handle` varchar(255) NOT NULL,
  `landing_page_path` varchar(500) NOT NULL,
  `landing_page_url` varchar(500) DEFAULT NULL,
  `product_title` varchar(255) DEFAULT NULL,
  `status` varchar(50) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_product_id` (`product_id`),
  KEY `idx_landing_page_path` (`landing_page_path`(200)),
  KEY `idx_handle` (`handle`)
) ENGINE=InnoDB AUTO_INCREMENT=2142 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `product_sessions_snapshot`
--

DROP TABLE IF EXISTS `product_sessions_snapshot`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `product_sessions_snapshot` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `date` date NOT NULL,
  `landing_page_type` varchar(100) NOT NULL,
  `landing_page_path` varchar(500) NOT NULL,
  `product_id` varchar(50) DEFAULT NULL,
  `product_title` varchar(255) DEFAULT NULL,
  `utm_source` varchar(255) DEFAULT NULL,
  `utm_medium` varchar(255) DEFAULT NULL,
  `utm_campaign` varchar(255) DEFAULT NULL,
  `utm_content` varchar(255) DEFAULT NULL,
  `utm_term` varchar(255) DEFAULT NULL,
  `referrer_name` varchar(255) DEFAULT NULL,
  `sessions` int DEFAULT '0',
  `sessions_with_cart_additions` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `landing_page_path_norm` varchar(500) GENERATED ALWAYS AS (if((`landing_page_path` = _utf8mb4'/'),_utf8mb4'/',trim(trailing _utf8mb4'/' from `landing_page_path`))) STORED,
  `dim_hash` binary(20) GENERATED ALWAYS AS (unhex(sha(concat_ws(_utf8mb4'|',`landing_page_type`,`landing_page_path`,ifnull(`utm_source`,_utf8mb4''),ifnull(`utm_medium`,_utf8mb4''),ifnull(`utm_campaign`,_utf8mb4''),ifnull(`utm_content`,_utf8mb4''),ifnull(`utm_term`,_utf8mb4''),ifnull(`referrer_name`,_utf8mb4''))))) STORED,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_date_dim` (`date`,`dim_hash`),
  KEY `idx_date` (`date`),
  KEY `idx_date_path` (`date`,`landing_page_path`(200)),
  KEY `idx_page_path` (`landing_page_path`(200)),
  KEY `idx_date_campaign` (`date`,`utm_campaign`(150)),
  KEY `idx_date_referrer` (`date`,`referrer_name`(100)),
  KEY `idx_product_id` (`product_id`),
  KEY `idx_date_norm` (`date`,`landing_page_path_norm`(200)),
  KEY `idx_date_updated` (`date`,`updated_at`)
) ENGINE=InnoDB AUTO_INCREMENT=3080726 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `products_sold_units_daily`
--

DROP TABLE IF EXISTS `products_sold_units_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `products_sold_units_daily` (
  `product_id` bigint NOT NULL,
  `variant_id` bigint NOT NULL,
  `sold_units_7d` int NOT NULL DEFAULT '0',
  `sold_units_30d` int NOT NULL DEFAULT '0',
  `sold_units_90d` int NOT NULL DEFAULT '0',
  `last_processed_at` datetime NOT NULL,
  PRIMARY KEY (`product_id`,`variant_id`),
  KEY `idx_product_id` (`product_id`),
  KEY `idx_last_processed_at` (`last_processed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `returns_fact`
--

DROP TABLE IF EXISTS `returns_fact`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `returns_fact` (
  `order_id` bigint NOT NULL,
  `event_date` date NOT NULL,
  `event_type` enum('CANCEL','REFUND') NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  PRIMARY KEY (`order_id`,`event_type`,`event_date`),
  KEY `idx_event_date` (`event_date`),
  KEY `idx_returns_fact_order_type_date` (`order_id`,`event_type`,`event_date`,`amount`),
  KEY `idx_returns_order_id` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sales_summary`
--

DROP TABLE IF EXISTS `sales_summary`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales_summary` (
  `date` date NOT NULL,
  `gokwik_sales` double NOT NULL DEFAULT '0',
  `gokwik_returns` double NOT NULL DEFAULT '0',
  `actual_gokwik_sale` double NOT NULL DEFAULT '0',
  `KwikEngageSales` double NOT NULL DEFAULT '0',
  `KwikEngageReturns` double NOT NULL DEFAULT '0',
  `actual_KwikEngage_sale` double NOT NULL DEFAULT '0',
  `online_store_sales` double NOT NULL DEFAULT '0',
  `online_store_returns` double NOT NULL DEFAULT '0',
  `actual_online_store_sale` double NOT NULL DEFAULT '0',
  `hypd_store_sales` double NOT NULL DEFAULT '0',
  `hypd_store_returns` double NOT NULL DEFAULT '0',
  `actual_hypd_store_sale` double NOT NULL DEFAULT '0',
  `draft_order_sales` double NOT NULL DEFAULT '0',
  `draft_order_returns` double NOT NULL DEFAULT '0',
  `actual_draft_order_sale` double NOT NULL DEFAULT '0',
  `dpanda_sales` double NOT NULL DEFAULT '0',
  `dpanda_returns` double NOT NULL DEFAULT '0',
  `actual_dpanda_sale` double NOT NULL DEFAULT '0',
  `gkappbrew_sales` double NOT NULL DEFAULT '0',
  `gkappbrew_returns` double NOT NULL DEFAULT '0',
  `actual_gkappbrew_sale` double NOT NULL DEFAULT '0',
  `buykaro_sales` double NOT NULL DEFAULT '0',
  `buykaro_returns` double NOT NULL DEFAULT '0',
  `actual_buykaro_sale` double NOT NULL DEFAULT '0',
  `appbrewplus_sales` double NOT NULL DEFAULT '0',
  `appbrewplus_returns` double NOT NULL DEFAULT '0',
  `actual_appbrewplus_sale` double NOT NULL DEFAULT '0',
  `shopflo_sales` decimal(12,2) DEFAULT '0.00',
  `shopflo_returns` decimal(12,2) DEFAULT '0.00',
  `actual_shopflo_sale` decimal(12,2) DEFAULT '0.00',
  `overall_sales_WO_hypd` double NOT NULL DEFAULT '0',
  `overall_returns_WO_hypd` double NOT NULL DEFAULT '0',
  `actual_overall_sales_WO_hypd` double NOT NULL DEFAULT '0',
  `overall_sales` double NOT NULL DEFAULT '0',
  `overall_returns` decimal(56,2) NOT NULL DEFAULT '0.00',
  `actual_overall_sales` double NOT NULL DEFAULT '0',
  PRIMARY KEY (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sales_summary_stage`
--

DROP TABLE IF EXISTS `sales_summary_stage`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales_summary_stage` (
  `date` date NOT NULL,
  `gokwik_sales` double NOT NULL DEFAULT '0',
  `gokwik_returns` double NOT NULL DEFAULT '0',
  `actual_gokwik_sale` double NOT NULL DEFAULT '0',
  `KwikEngageSales` double NOT NULL DEFAULT '0',
  `KwikEngageReturns` double NOT NULL DEFAULT '0',
  `actual_KwikEngage_sale` double NOT NULL DEFAULT '0',
  `online_store_sales` double NOT NULL DEFAULT '0',
  `online_store_returns` double NOT NULL DEFAULT '0',
  `actual_online_store_sale` double NOT NULL DEFAULT '0',
  `hypd_store_sales` double NOT NULL DEFAULT '0',
  `hypd_store_returns` double NOT NULL DEFAULT '0',
  `actual_hypd_store_sale` double NOT NULL DEFAULT '0',
  `draft_order_sales` double NOT NULL DEFAULT '0',
  `draft_order_returns` double NOT NULL DEFAULT '0',
  `actual_draft_order_sale` double NOT NULL DEFAULT '0',
  `dpanda_sales` double NOT NULL DEFAULT '0',
  `dpanda_returns` double NOT NULL DEFAULT '0',
  `actual_dpanda_sale` double NOT NULL DEFAULT '0',
  `gkappbrew_sales` double NOT NULL DEFAULT '0',
  `gkappbrew_returns` double NOT NULL DEFAULT '0',
  `actual_gkappbrew_sale` double NOT NULL DEFAULT '0',
  `buykaro_sales` double NOT NULL DEFAULT '0',
  `buykaro_returns` double NOT NULL DEFAULT '0',
  `actual_buykaro_sale` double NOT NULL DEFAULT '0',
  `appbrewplus_sales` double NOT NULL DEFAULT '0',
  `appbrewplus_returns` double NOT NULL DEFAULT '0',
  `actual_appbrewplus_sale` double NOT NULL DEFAULT '0',
  `shopflo_sales` decimal(12,2) DEFAULT '0.00',
  `shopflo_returns` decimal(12,2) DEFAULT '0.00',
  `actual_shopflo_sale` decimal(12,2) DEFAULT '0.00',
  `overall_sales_WO_hypd` double NOT NULL DEFAULT '0',
  `overall_returns_WO_hypd` double NOT NULL DEFAULT '0',
  `actual_overall_sales_WO_hypd` double NOT NULL DEFAULT '0',
  `overall_sales` double NOT NULL DEFAULT '0',
  `overall_returns` decimal(56,2) NOT NULL DEFAULT '0.00',
  `actual_overall_sales` double NOT NULL DEFAULT '0',
  PRIMARY KEY (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `session_adjustment_audit`
--

DROP TABLE IF EXISTS `session_adjustment_audit`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `session_adjustment_audit` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `bucket_id` bigint unsigned NOT NULL,
  `brand_key` varchar(32) DEFAULT NULL,
  `action` enum('CREATE','UPDATE','DEACTIVATE','DELETE') NOT NULL,
  `before_json` json DEFAULT NULL,
  `after_json` json DEFAULT NULL,
  `author_user_id` bigint DEFAULT NULL,
  `changed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bucket` (`bucket_id`),
  KEY `idx_changed_at` (`changed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `session_adjustment_buckets`
--

DROP TABLE IF EXISTS `session_adjustment_buckets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `session_adjustment_buckets` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `brand_key` varchar(32) NOT NULL,
  `lower_bound_sessions` bigint unsigned NOT NULL,
  `upper_bound_sessions` bigint unsigned NOT NULL,
  `offset_pct` decimal(5,2) NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `priority` int NOT NULL DEFAULT '100',
  `effective_from` date DEFAULT NULL,
  `effective_to` date DEFAULT NULL,
  `notes` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_buckets_active_from` (`active`,`effective_from`),
  KEY `idx_buckets_active_to` (`active`,`effective_to`),
  KEY `idx_buckets_priority` (`active`,`priority`),
  KEY `idx_bkt_brand_active_prio` (`brand_key`,`active`,`priority`),
  KEY `idx_bkt_brand_active_from` (`brand_key`,`active`,`effective_from`),
  KEY `idx_bkt_brand_active_to` (`brand_key`,`active`,`effective_to`),
  CONSTRAINT `chk_bounds` CHECK ((`lower_bound_sessions` <= `upper_bound_sessions`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sessions_summary`
--

DROP TABLE IF EXISTS `sessions_summary`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sessions_summary` (
  `date` date NOT NULL,
  `number_of_sessions` int DEFAULT '0',
  `number_of_atc_sessions` int DEFAULT '0',
  `adjusted_number_of_sessions` int DEFAULT NULL,
  PRIMARY KEY (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `shopify_orders`
--

DROP TABLE IF EXISTS `shopify_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `shopify_orders` (
  `created_at` datetime DEFAULT NULL,
  `created_date` varchar(10) DEFAULT NULL,
  `created_time` varchar(8) DEFAULT NULL,
  `order_id` varchar(50) DEFAULT NULL,
  `order_name` varchar(50) DEFAULT NULL,
  `customer_id` varchar(50) DEFAULT NULL,
  `customer_email` varchar(100) DEFAULT NULL,
  `customer_first_name` varchar(100) DEFAULT NULL,
  `customer_last_name` varchar(100) DEFAULT NULL,
  `customer_phone` varchar(30) DEFAULT NULL,
  `financial_status` varchar(50) DEFAULT NULL,
  `fulfillment_status` varchar(50) DEFAULT NULL,
  `currency` varchar(10) DEFAULT NULL,
  `discount_codes` text,
  `discount_amount` float DEFAULT NULL,
  `discount_application_titles` text,
  `discount_application_values` text,
  `discount_application_types` text,
  `discount_application_ids` text,
  `order_app_id` varchar(50) DEFAULT NULL,
  `order_app_name` varchar(100) DEFAULT NULL,
  `total_price` float DEFAULT NULL,
  `shipping_price` float DEFAULT NULL,
  `total_tax` float DEFAULT NULL,
  `payment_gateway_names` text,
  `total_discounts` float DEFAULT NULL,
  `total_duties` float DEFAULT NULL,
  `sku` varchar(100) DEFAULT NULL,
  `variant_title` varchar(100) DEFAULT NULL,
  `line_item` varchar(255) DEFAULT NULL,
  `line_item_price` float DEFAULT NULL,
  `line_item_quantity` int DEFAULT NULL,
  `line_item_total_discount` float DEFAULT NULL,
  `product_id` varchar(50) DEFAULT NULL,
  `variant_id` varchar(50) DEFAULT NULL,
  `tags` text,
  `updated_at` datetime DEFAULT NULL,
  `updated_date` varchar(10) DEFAULT NULL,
  `updated_time` varchar(8) DEFAULT NULL,
  `orig_referrer` text,
  `full_url` text,
  `customer_ip` varchar(50) DEFAULT NULL,
  `pg_order_id` varchar(50) DEFAULT NULL,
  `shipping_address` text,
  `shipping_phone` varchar(30) DEFAULT NULL,
  `shipping_city` varchar(100) DEFAULT NULL,
  `shipping_zip` varchar(20) DEFAULT NULL,
  `shipping_province` varchar(100) DEFAULT NULL,
  `billing_address` text,
  `billing_phone` varchar(30) DEFAULT NULL,
  `billing_city` varchar(100) DEFAULT NULL,
  `billing_zip` varchar(20) DEFAULT NULL,
  `billing_province` varchar(100) DEFAULT NULL,
  `customer_tag` text,
  `appmaker_platform` varchar(50) DEFAULT NULL,
  `app_version` varchar(50) DEFAULT NULL,
  `_ITEM1_name` varchar(255) DEFAULT NULL,
  `_ITEM1_value` varchar(255) DEFAULT NULL,
  `_ITEM2_name` varchar(255) DEFAULT NULL,
  `_ITEM2_value` varchar(255) DEFAULT NULL,
  `_ITEM3_name` varchar(255) DEFAULT NULL,
  `_ITEM3_value` varchar(255) DEFAULT NULL,
  `_ITEM4_name` varchar(255) DEFAULT NULL,
  `_ITEM4_value` varchar(255) DEFAULT NULL,
  `_ITEM5_name` varchar(255) DEFAULT NULL,
  `_ITEM5_value` varchar(255) DEFAULT NULL,
  `_ITEM6_name` varchar(255) DEFAULT NULL,
  `_ITEM6_value` varchar(255) DEFAULT NULL,
  `_ITEM7_name` varchar(255) DEFAULT NULL,
  `_ITEM7_value` varchar(255) DEFAULT NULL,
  `_ITEM8_name` varchar(255) DEFAULT NULL,
  `_ITEM8_value` varchar(255) DEFAULT NULL,
  `_ITEM9_name` varchar(255) DEFAULT NULL,
  `_ITEM9_value` varchar(255) DEFAULT NULL,
  `_ITEM10_name` varchar(255) DEFAULT NULL,
  `_ITEM10_value` varchar(255) DEFAULT NULL,
  `created_dt` date GENERATED ALWAYS AS (cast(`created_at` as date)) STORED,
  `created_hr` tinyint GENERATED ALWAYS AS (hour(`created_at`)) STORED,
  `discount_amount_per_line_item` double DEFAULT NULL,
  `utm_source` text,
  `utm_medium` text,
  `utm_campaign` text,
  `utm_content` text,
  `utm_term` text,
  `user_agent` text,
  KEY `idx_updated_at` (`updated_at`),
  KEY `idx_orders_created_dt_hr` (`created_dt`,`created_hr`),
  KEY `idx_orders_created_dt_price` (`created_dt`,`total_price`),
  KEY `idx_so_pg` (`payment_gateway_names`(50)),
  KEY `ix_so_created_dt_app` (`created_dt`,`order_app_name`),
  KEY `ix_so_order_id_created_dt` (`order_id`,`created_dt`),
  KEY `idx_created_product_qty` (`created_dt`,`product_id`,`line_item_quantity`),
  KEY `idx_customer_created` (`customer_id`,`created_at`),
  KEY `idx_so_created_dt_utm_source` (`created_dt`,`utm_source`(128)),
  KEY `idx_so_created_dt_utm_medium` (`created_dt`,`utm_medium`(128)),
  KEY `idx_so_created_dt_utm_campaign` (`created_dt`,`utm_campaign`(128)),
  KEY `idx_so_created_date_totalprice` (`created_date`,`total_price`),
  KEY `idx_so_created_date_order` (`created_date`,`order_id`),
  KEY `idx_created_at_order_id` (`created_at`,`order_id`),
  KEY `idx_created_dt_product` (`created_dt`,`product_id`),
  KEY `idx_created_dt_hr_product` (`created_dt`,`created_hr`,`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `shopify_orders_update`
--

DROP TABLE IF EXISTS `shopify_orders_update`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `shopify_orders_update` (
  `created_at` datetime DEFAULT NULL,
  `created_date` varchar(10) DEFAULT NULL,
  `created_time` varchar(8) DEFAULT NULL,
  `order_id` varchar(50) DEFAULT NULL,
  `order_name` varchar(50) DEFAULT NULL,
  `customer_id` varchar(50) DEFAULT NULL,
  `customer_email` varchar(100) DEFAULT NULL,
  `customer_first_name` varchar(100) DEFAULT NULL,
  `customer_last_name` varchar(100) DEFAULT NULL,
  `customer_phone` varchar(30) DEFAULT NULL,
  `financial_status` varchar(50) DEFAULT NULL,
  `fulfillment_status` varchar(50) DEFAULT NULL,
  `currency` varchar(10) DEFAULT NULL,
  `discount_codes` text,
  `discount_amount` float DEFAULT NULL,
  `discount_application_titles` text,
  `discount_application_values` text,
  `discount_application_types` text,
  `discount_application_ids` text,
  `order_app_id` varchar(50) DEFAULT NULL,
  `order_app_name` varchar(100) DEFAULT NULL,
  `total_price` float DEFAULT NULL,
  `shipping_price` float DEFAULT NULL,
  `total_tax` float DEFAULT NULL,
  `payment_gateway_names` text,
  `total_discounts` float DEFAULT NULL,
  `total_duties` float DEFAULT NULL,
  `sku` varchar(100) DEFAULT NULL,
  `variant_title` varchar(100) DEFAULT NULL,
  `line_item` varchar(255) DEFAULT NULL,
  `line_item_price` float DEFAULT NULL,
  `line_item_quantity` int DEFAULT NULL,
  `line_item_total_discount` float DEFAULT NULL,
  `product_id` varchar(50) DEFAULT NULL,
  `variant_id` varchar(50) DEFAULT NULL,
  `tags` text,
  `updated_at` datetime DEFAULT NULL,
  `updated_date` varchar(10) DEFAULT NULL,
  `updated_time` varchar(8) DEFAULT NULL,
  `orig_referrer` text,
  `full_url` text,
  `customer_ip` varchar(50) DEFAULT NULL,
  `pg_order_id` varchar(50) DEFAULT NULL,
  `shipping_address` text,
  `shipping_phone` varchar(30) DEFAULT NULL,
  `shipping_city` varchar(100) DEFAULT NULL,
  `shipping_zip` varchar(20) DEFAULT NULL,
  `shipping_province` varchar(100) DEFAULT NULL,
  `billing_address` text,
  `billing_phone` varchar(30) DEFAULT NULL,
  `billing_city` varchar(100) DEFAULT NULL,
  `billing_zip` varchar(20) DEFAULT NULL,
  `billing_province` varchar(100) DEFAULT NULL,
  `customer_tag` text,
  `appmaker_platform` varchar(50) DEFAULT NULL,
  `app_version` varchar(50) DEFAULT NULL,
  `_ITEM1_name` varchar(255) DEFAULT NULL,
  `_ITEM1_value` varchar(255) DEFAULT NULL,
  `_ITEM2_name` varchar(255) DEFAULT NULL,
  `_ITEM2_value` varchar(255) DEFAULT NULL,
  `_ITEM3_name` varchar(255) DEFAULT NULL,
  `_ITEM3_value` varchar(255) DEFAULT NULL,
  `_ITEM4_name` varchar(255) DEFAULT NULL,
  `_ITEM4_value` varchar(255) DEFAULT NULL,
  `_ITEM5_name` varchar(255) DEFAULT NULL,
  `_ITEM5_value` varchar(255) DEFAULT NULL,
  `_ITEM6_name` varchar(255) DEFAULT NULL,
  `_ITEM6_value` varchar(255) DEFAULT NULL,
  `_ITEM7_name` varchar(255) DEFAULT NULL,
  `_ITEM7_value` varchar(255) DEFAULT NULL,
  `_ITEM8_name` varchar(255) DEFAULT NULL,
  `_ITEM8_value` varchar(255) DEFAULT NULL,
  `_ITEM9_name` varchar(255) DEFAULT NULL,
  `_ITEM9_value` varchar(255) DEFAULT NULL,
  `_ITEM10_name` varchar(255) DEFAULT NULL,
  `_ITEM10_value` varchar(255) DEFAULT NULL,
  `updated_dt` date GENERATED ALWAYS AS (cast(`updated_at` as date)) STORED,
  `updated_hr` tinyint GENERATED ALWAYS AS (hour(`updated_at`)) STORED,
  `has_refund_credited` tinyint(1) GENERATED ALWAYS AS ((locate(_utf8mb4'Refund_credited',`tags`) > 0)) STORED,
  `discount_amount_per_line_item` double DEFAULT NULL,
  `utm_source` text,
  `utm_medium` text,
  `utm_campaign` text,
  `utm_content` text,
  `utm_term` text,
  `user_agent` text,
  KEY `idx_updated_at` (`updated_at`),
  KEY `idx_upd_dt_status_price` (`updated_date`,`financial_status`,`total_price`),
  KEY `idx_upd_order_name` (`order_name`),
  KEY `idx_order_id` (`order_id`),
  KEY `ix_sou_updated_dt` (`updated_dt`),
  KEY `idx_sou_updated_date_status` (`updated_date`,`financial_status`),
  KEY `idx_sou_updated_date_order` (`updated_date`,`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `shopify_orders_utm_daily`
--

DROP TABLE IF EXISTS `shopify_orders_utm_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `shopify_orders_utm_daily` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `date` date NOT NULL,
  `utm_source` varchar(255) NOT NULL,
  `utm_medium` varchar(255) NOT NULL,
  `utm_campaign` varchar(255) NOT NULL,
  `utm_content` varchar(255) NOT NULL,
  `utm_term` varchar(255) NOT NULL,
  `total_orders` int DEFAULT '0',
  `total_sales` decimal(12,2) DEFAULT '0.00',
  `total_discounts` decimal(12,2) DEFAULT '0.00',
  `shipping_total` decimal(12,2) DEFAULT '0.00',
  `tax_total` decimal(12,2) DEFAULT '0.00',
  `net_sales` decimal(12,2) DEFAULT '0.00',
  `aov` decimal(12,2) DEFAULT '0.00',
  `utm_key` char(64) NOT NULL,
  `number_of_sessions` int DEFAULT '0',
  `number_of_atc_sessions` int DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_utm_day` (`date`,`utm_key`),
  KEY `idx_soud_source_date` (`utm_source`,`date`),
  KEY `idx_soud_medium_date` (`utm_medium`,`date`),
  KEY `idx_soud_campaign_date` (`utm_campaign`,`date`)
) ENGINE=InnoDB AUTO_INCREMENT=241964 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `top_products_inventory`
--

DROP TABLE IF EXISTS `top_products_inventory`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `top_products_inventory` (
  `product_id` bigint NOT NULL,
  `product_title` varchar(500) NOT NULL,
  `variant_id` bigint NOT NULL,
  `variant_title` varchar(255) NOT NULL,
  `sku` varchar(255) DEFAULT NULL,
  `inventory_available` int NOT NULL DEFAULT '0',
  `sold_units_7d` int NOT NULL DEFAULT '0',
  `sold_units_30d` int NOT NULL DEFAULT '0',
  `sold_units_90d` int NOT NULL DEFAULT '0',
  `drr_7d` decimal(10,2) NOT NULL DEFAULT '0.00',
  `drr_30d` decimal(10,2) NOT NULL DEFAULT '0.00',
  `drr_90d` decimal(10,2) NOT NULL DEFAULT '0.00',
  `doh_7d` decimal(12,2) NOT NULL DEFAULT '0.00',
  `doh_30d` decimal(12,2) NOT NULL DEFAULT '0.00',
  `doh_90d` decimal(12,2) NOT NULL DEFAULT '0.00',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`variant_id`),
  KEY `idx_product_id` (`product_id`),
  KEY `idx_sku` (`sku`),
  KEY `idx_inventory_available` (`inventory_available`),
  KEY `idx_updated_at` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` varchar(255) NOT NULL DEFAULT 'user',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `utm_campaign_daily`
--

DROP TABLE IF EXISTS `utm_campaign_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `utm_campaign_daily` (
  `metric_date` date DEFAULT NULL,
  `utm_campaign` varchar(255) DEFAULT NULL,
  `orders` int DEFAULT '0',
  `sales` decimal(15,2) DEFAULT '0.00',
  `average_order_value` decimal(15,2) DEFAULT '0.00',
  `sessions` int DEFAULT '0',
  `atc_sessions` int DEFAULT '0',
  `conversion_rate` decimal(5,4) DEFAULT '0.0000',
  `cancellation_rate` decimal(5,4) DEFAULT '0.0000',
  `refund_rate` decimal(5,4) DEFAULT '0.0000',
  `prepaid_orders` int DEFAULT '0',
  `cod_orders` int DEFAULT '0',
  `ppcod_orders` int DEFAULT '0',
  `cancelled_orders` int DEFAULT '0',
  `refunded_orders` int DEFAULT '0',
  KEY `idx_utm_campaign_daily_dims` (`metric_date`,`utm_campaign`),
  KEY `idx_utm_campaign_daily_utm_campaign` (`utm_campaign`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `utm_campaign_hourly`
--

DROP TABLE IF EXISTS `utm_campaign_hourly`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `utm_campaign_hourly` (
  `metric_date` date DEFAULT NULL,
  `metric_hour` int DEFAULT NULL,
  `utm_campaign` varchar(255) DEFAULT NULL,
  `orders` int DEFAULT '0',
  `sales` decimal(15,2) DEFAULT '0.00',
  `average_order_value` decimal(15,2) DEFAULT '0.00',
  `sessions` int DEFAULT '0',
  `atc_sessions` int DEFAULT '0',
  `conversion_rate` decimal(5,4) DEFAULT '0.0000',
  `cancellation_rate` decimal(5,4) DEFAULT '0.0000',
  `refund_rate` decimal(5,4) DEFAULT '0.0000',
  `prepaid_orders` int DEFAULT '0',
  `cod_orders` int DEFAULT '0',
  `ppcod_orders` int DEFAULT '0',
  `cancelled_orders` int DEFAULT '0',
  `refunded_orders` int DEFAULT '0',
  KEY `idx_utm_campaign_hourly_dims` (`metric_date`,`metric_hour`,`utm_campaign`),
  KEY `idx_utm_campaign_hourly_utm_campaign` (`utm_campaign`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `utm_medium_campaign_daily`
--

DROP TABLE IF EXISTS `utm_medium_campaign_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `utm_medium_campaign_daily` (
  `metric_date` date DEFAULT NULL,
  `utm_medium` varchar(255) DEFAULT NULL,
  `utm_campaign` varchar(255) DEFAULT NULL,
  `orders` int DEFAULT '0',
  `sales` decimal(15,2) DEFAULT '0.00',
  `average_order_value` decimal(15,2) DEFAULT '0.00',
  `sessions` int DEFAULT '0',
  `atc_sessions` int DEFAULT '0',
  `conversion_rate` decimal(5,4) DEFAULT '0.0000',
  `cancellation_rate` decimal(5,4) DEFAULT '0.0000',
  `refund_rate` decimal(5,4) DEFAULT '0.0000',
  `prepaid_orders` int DEFAULT '0',
  `cod_orders` int DEFAULT '0',
  `ppcod_orders` int DEFAULT '0',
  `cancelled_orders` int DEFAULT '0',
  `refunded_orders` int DEFAULT '0',
  KEY `idx_utm_medium_campaign_daily_dims` (`metric_date`,`utm_medium`,`utm_campaign`),
  KEY `idx_utm_medium_campaign_daily_utm_medium` (`utm_medium`),
  KEY `idx_utm_medium_campaign_daily_utm_campaign` (`utm_campaign`),
  KEY `idx_utm_medium_campaign_daily_med_cam` (`utm_medium`,`utm_campaign`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `utm_medium_campaign_hourly`
--

DROP TABLE IF EXISTS `utm_medium_campaign_hourly`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `utm_medium_campaign_hourly` (
  `metric_date` date DEFAULT NULL,
  `metric_hour` int DEFAULT NULL,
  `utm_medium` varchar(255) DEFAULT NULL,
  `utm_campaign` varchar(255) DEFAULT NULL,
  `orders` int DEFAULT '0',
  `sales` decimal(15,2) DEFAULT '0.00',
  `average_order_value` decimal(15,2) DEFAULT '0.00',
  `sessions` int DEFAULT '0',
  `atc_sessions` int DEFAULT '0',
  `conversion_rate` decimal(5,4) DEFAULT '0.0000',
  `cancellation_rate` decimal(5,4) DEFAULT '0.0000',
  `refund_rate` decimal(5,4) DEFAULT '0.0000',
  `prepaid_orders` int DEFAULT '0',
  `cod_orders` int DEFAULT '0',
  `ppcod_orders` int DEFAULT '0',
  `cancelled_orders` int DEFAULT '0',
  `refunded_orders` int DEFAULT '0',
  KEY `idx_utm_medium_campaign_hourly_dims` (`metric_date`,`metric_hour`,`utm_medium`,`utm_campaign`),
  KEY `idx_utm_medium_campaign_hourly_utm_medium` (`utm_medium`),
  KEY `idx_utm_medium_campaign_hourly_utm_campaign` (`utm_campaign`),
  KEY `idx_utm_medium_campaign_hourly_med_cam` (`utm_medium`,`utm_campaign`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `utm_medium_daily`
--

DROP TABLE IF EXISTS `utm_medium_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `utm_medium_daily` (
  `metric_date` date DEFAULT NULL,
  `utm_medium` varchar(255) DEFAULT NULL,
  `orders` int DEFAULT '0',
  `sales` decimal(15,2) DEFAULT '0.00',
  `average_order_value` decimal(15,2) DEFAULT '0.00',
  `sessions` int DEFAULT '0',
  `atc_sessions` int DEFAULT '0',
  `conversion_rate` decimal(5,4) DEFAULT '0.0000',
  `cancellation_rate` decimal(5,4) DEFAULT '0.0000',
  `refund_rate` decimal(5,4) DEFAULT '0.0000',
  `prepaid_orders` int DEFAULT '0',
  `cod_orders` int DEFAULT '0',
  `ppcod_orders` int DEFAULT '0',
  `cancelled_orders` int DEFAULT '0',
  `refunded_orders` int DEFAULT '0',
  KEY `idx_utm_medium_daily_dims` (`metric_date`,`utm_medium`),
  KEY `idx_utm_medium_daily_utm_medium` (`utm_medium`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `utm_medium_hourly`
--

DROP TABLE IF EXISTS `utm_medium_hourly`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `utm_medium_hourly` (
  `metric_date` date DEFAULT NULL,
  `metric_hour` int DEFAULT NULL,
  `utm_medium` varchar(255) DEFAULT NULL,
  `orders` int DEFAULT '0',
  `sales` decimal(15,2) DEFAULT '0.00',
  `average_order_value` decimal(15,2) DEFAULT '0.00',
  `sessions` int DEFAULT '0',
  `atc_sessions` int DEFAULT '0',
  `conversion_rate` decimal(5,4) DEFAULT '0.0000',
  `cancellation_rate` decimal(5,4) DEFAULT '0.0000',
  `refund_rate` decimal(5,4) DEFAULT '0.0000',
  `prepaid_orders` int DEFAULT '0',
  `cod_orders` int DEFAULT '0',
  `ppcod_orders` int DEFAULT '0',
  `cancelled_orders` int DEFAULT '0',
  `refunded_orders` int DEFAULT '0',
  KEY `idx_utm_medium_hourly_dims` (`metric_date`,`metric_hour`,`utm_medium`),
  KEY `idx_utm_medium_hourly_utm_medium` (`utm_medium`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `utm_source_campaign_daily`
--

DROP TABLE IF EXISTS `utm_source_campaign_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `utm_source_campaign_daily` (
  `metric_date` date DEFAULT NULL,
  `utm_source` varchar(255) DEFAULT NULL,
  `utm_campaign` varchar(255) DEFAULT NULL,
  `orders` int DEFAULT '0',
  `sales` decimal(15,2) DEFAULT '0.00',
  `average_order_value` decimal(15,2) DEFAULT '0.00',
  `sessions` int DEFAULT '0',
  `atc_sessions` int DEFAULT '0',
  `conversion_rate` decimal(5,4) DEFAULT '0.0000',
  `cancellation_rate` decimal(5,4) DEFAULT '0.0000',
  `refund_rate` decimal(5,4) DEFAULT '0.0000',
  `prepaid_orders` int DEFAULT '0',
  `cod_orders` int DEFAULT '0',
  `ppcod_orders` int DEFAULT '0',
  `cancelled_orders` int DEFAULT '0',
  `refunded_orders` int DEFAULT '0',
  KEY `idx_utm_source_campaign_daily_dims` (`metric_date`,`utm_source`,`utm_campaign`),
  KEY `idx_utm_source_campaign_daily_utm_source` (`utm_source`),
  KEY `idx_utm_source_campaign_daily_utm_campaign` (`utm_campaign`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `utm_source_campaign_hourly`
--

DROP TABLE IF EXISTS `utm_source_campaign_hourly`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `utm_source_campaign_hourly` (
  `metric_date` date DEFAULT NULL,
  `metric_hour` int DEFAULT NULL,
  `utm_source` varchar(255) DEFAULT NULL,
  `utm_campaign` varchar(255) DEFAULT NULL,
  `orders` int DEFAULT '0',
  `sales` decimal(15,2) DEFAULT '0.00',
  `average_order_value` decimal(15,2) DEFAULT '0.00',
  `sessions` int DEFAULT '0',
  `atc_sessions` int DEFAULT '0',
  `conversion_rate` decimal(5,4) DEFAULT '0.0000',
  `cancellation_rate` decimal(5,4) DEFAULT '0.0000',
  `refund_rate` decimal(5,4) DEFAULT '0.0000',
  `prepaid_orders` int DEFAULT '0',
  `cod_orders` int DEFAULT '0',
  `ppcod_orders` int DEFAULT '0',
  `cancelled_orders` int DEFAULT '0',
  `refunded_orders` int DEFAULT '0',
  KEY `idx_utm_source_campaign_hourly_dims` (`metric_date`,`metric_hour`,`utm_source`,`utm_campaign`),
  KEY `idx_utm_source_campaign_hourly_utm_source` (`utm_source`),
  KEY `idx_utm_source_campaign_hourly_utm_campaign` (`utm_campaign`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `utm_source_daily`
--

DROP TABLE IF EXISTS `utm_source_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `utm_source_daily` (
  `metric_date` date DEFAULT NULL,
  `utm_source` varchar(255) DEFAULT NULL,
  `orders` int DEFAULT '0',
  `sales` decimal(15,2) DEFAULT '0.00',
  `average_order_value` decimal(15,2) DEFAULT '0.00',
  `sessions` int DEFAULT '0',
  `atc_sessions` int DEFAULT '0',
  `conversion_rate` decimal(5,4) DEFAULT '0.0000',
  `cancellation_rate` decimal(5,4) DEFAULT '0.0000',
  `refund_rate` decimal(5,4) DEFAULT '0.0000',
  `prepaid_orders` int DEFAULT '0',
  `cod_orders` int DEFAULT '0',
  `ppcod_orders` int DEFAULT '0',
  `cancelled_orders` int DEFAULT '0',
  `refunded_orders` int DEFAULT '0',
  KEY `idx_utm_source_daily_dims` (`metric_date`,`utm_source`),
  KEY `idx_utm_source_daily_utm_source` (`utm_source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `utm_source_hourly`
--

DROP TABLE IF EXISTS `utm_source_hourly`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `utm_source_hourly` (
  `metric_date` date DEFAULT NULL,
  `metric_hour` int DEFAULT NULL,
  `utm_source` varchar(255) DEFAULT NULL,
  `orders` int DEFAULT '0',
  `sales` decimal(15,2) DEFAULT '0.00',
  `average_order_value` decimal(15,2) DEFAULT '0.00',
  `sessions` int DEFAULT '0',
  `atc_sessions` int DEFAULT '0',
  `conversion_rate` decimal(5,4) DEFAULT '0.0000',
  `cancellation_rate` decimal(5,4) DEFAULT '0.0000',
  `refund_rate` decimal(5,4) DEFAULT '0.0000',
  `prepaid_orders` int DEFAULT '0',
  `cod_orders` int DEFAULT '0',
  `ppcod_orders` int DEFAULT '0',
  `cancelled_orders` int DEFAULT '0',
  `refunded_orders` int DEFAULT '0',
  KEY `idx_utm_source_hourly_dims` (`metric_date`,`metric_hour`,`utm_source`),
  KEY `idx_utm_source_hourly_utm_source` (`utm_source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `utm_source_medium_campaign_daily`
--

DROP TABLE IF EXISTS `utm_source_medium_campaign_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `utm_source_medium_campaign_daily` (
  `metric_date` date DEFAULT NULL,
  `utm_source` varchar(255) DEFAULT NULL,
  `utm_medium` varchar(255) DEFAULT NULL,
  `utm_campaign` varchar(255) DEFAULT NULL,
  `orders` int DEFAULT '0',
  `sales` decimal(15,2) DEFAULT '0.00',
  `average_order_value` decimal(15,2) DEFAULT '0.00',
  `sessions` int DEFAULT '0',
  `atc_sessions` int DEFAULT '0',
  `conversion_rate` decimal(5,4) DEFAULT '0.0000',
  `cancellation_rate` decimal(5,4) DEFAULT '0.0000',
  `refund_rate` decimal(5,4) DEFAULT '0.0000',
  `prepaid_orders` int DEFAULT '0',
  `cod_orders` int DEFAULT '0',
  `ppcod_orders` int DEFAULT '0',
  `cancelled_orders` int DEFAULT '0',
  `refunded_orders` int DEFAULT '0',
  KEY `idx_utm_source_medium_campaign_daily_dims` (`metric_date`,`utm_source`,`utm_medium`,`utm_campaign`),
  KEY `idx_utm_source_medium_campaign_daily_utm_source` (`utm_source`),
  KEY `idx_utm_source_medium_campaign_daily_utm_medium` (`utm_medium`),
  KEY `idx_utm_source_medium_campaign_daily_utm_campaign` (`utm_campaign`),
  KEY `idx_utm_source_medium_campaign_daily_src_med` (`utm_source`,`utm_medium`),
  KEY `idx_utm_source_medium_campaign_daily_med_cam` (`utm_medium`,`utm_campaign`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `utm_source_medium_campaign_hourly`
--

DROP TABLE IF EXISTS `utm_source_medium_campaign_hourly`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `utm_source_medium_campaign_hourly` (
  `metric_date` date DEFAULT NULL,
  `metric_hour` int DEFAULT NULL,
  `utm_source` varchar(255) DEFAULT NULL,
  `utm_medium` varchar(255) DEFAULT NULL,
  `utm_campaign` varchar(255) DEFAULT NULL,
  `orders` int DEFAULT '0',
  `sales` decimal(15,2) DEFAULT '0.00',
  `average_order_value` decimal(15,2) DEFAULT '0.00',
  `sessions` int DEFAULT '0',
  `atc_sessions` int DEFAULT '0',
  `conversion_rate` decimal(5,4) DEFAULT '0.0000',
  `cancellation_rate` decimal(5,4) DEFAULT '0.0000',
  `refund_rate` decimal(5,4) DEFAULT '0.0000',
  `prepaid_orders` int DEFAULT '0',
  `cod_orders` int DEFAULT '0',
  `ppcod_orders` int DEFAULT '0',
  `cancelled_orders` int DEFAULT '0',
  `refunded_orders` int DEFAULT '0',
  KEY `idx_utm_source_medium_campaign_hourly_dims` (`metric_date`,`metric_hour`,`utm_source`,`utm_medium`,`utm_campaign`),
  KEY `idx_utm_source_medium_campaign_hourly_utm_source` (`utm_source`),
  KEY `idx_utm_source_medium_campaign_hourly_utm_medium` (`utm_medium`),
  KEY `idx_utm_source_medium_campaign_hourly_utm_campaign` (`utm_campaign`),
  KEY `idx_utm_source_medium_campaign_hourly_src_med` (`utm_source`,`utm_medium`),
  KEY `idx_utm_source_medium_campaign_hourly_med_cam` (`utm_medium`,`utm_campaign`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `utm_source_medium_daily`
--

DROP TABLE IF EXISTS `utm_source_medium_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `utm_source_medium_daily` (
  `metric_date` date DEFAULT NULL,
  `utm_source` varchar(255) DEFAULT NULL,
  `utm_medium` varchar(255) DEFAULT NULL,
  `orders` int DEFAULT '0',
  `sales` decimal(15,2) DEFAULT '0.00',
  `average_order_value` decimal(15,2) DEFAULT '0.00',
  `sessions` int DEFAULT '0',
  `atc_sessions` int DEFAULT '0',
  `conversion_rate` decimal(5,4) DEFAULT '0.0000',
  `cancellation_rate` decimal(5,4) DEFAULT '0.0000',
  `refund_rate` decimal(5,4) DEFAULT '0.0000',
  `prepaid_orders` int DEFAULT '0',
  `cod_orders` int DEFAULT '0',
  `ppcod_orders` int DEFAULT '0',
  `cancelled_orders` int DEFAULT '0',
  `refunded_orders` int DEFAULT '0',
  KEY `idx_utm_source_medium_daily_dims` (`metric_date`,`utm_source`,`utm_medium`),
  KEY `idx_utm_source_medium_daily_utm_source` (`utm_source`),
  KEY `idx_utm_source_medium_daily_utm_medium` (`utm_medium`),
  KEY `idx_utm_source_medium_daily_src_med` (`utm_source`,`utm_medium`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `utm_source_medium_hourly`
--

DROP TABLE IF EXISTS `utm_source_medium_hourly`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `utm_source_medium_hourly` (
  `metric_date` date DEFAULT NULL,
  `metric_hour` int DEFAULT NULL,
  `utm_source` varchar(255) DEFAULT NULL,
  `utm_medium` varchar(255) DEFAULT NULL,
  `orders` int DEFAULT '0',
  `sales` decimal(15,2) DEFAULT '0.00',
  `average_order_value` decimal(15,2) DEFAULT '0.00',
  `sessions` int DEFAULT '0',
  `atc_sessions` int DEFAULT '0',
  `conversion_rate` decimal(5,4) DEFAULT '0.0000',
  `cancellation_rate` decimal(5,4) DEFAULT '0.0000',
  `refund_rate` decimal(5,4) DEFAULT '0.0000',
  `prepaid_orders` int DEFAULT '0',
  `cod_orders` int DEFAULT '0',
  `ppcod_orders` int DEFAULT '0',
  `cancelled_orders` int DEFAULT '0',
  `refunded_orders` int DEFAULT '0',
  KEY `idx_utm_source_medium_hourly_dims` (`metric_date`,`metric_hour`,`utm_source`,`utm_medium`),
  KEY `idx_utm_source_medium_hourly_utm_source` (`utm_source`),
  KEY `idx_utm_source_medium_hourly_utm_medium` (`utm_medium`),
  KEY `idx_utm_source_medium_hourly_src_med` (`utm_source`,`utm_medium`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping events for database 'AJMAL'
--

--
-- Dumping routines for database 'AJMAL'
--
--
-- WARNING: can't read the INFORMATION_SCHEMA.libraries table. It's most probably an old server 8.0.42.
--
--
-- WARNING: can't read the INFORMATION_SCHEMA.libraries table. It's most probably an old server 8.0.42.
--
/*!50003 DROP PROCEDURE IF EXISTS `batch_delete_all_tables_3` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`admin`@`%` PROCEDURE `batch_delete_all_tables_3`(
    IN p_start DATE,
    IN p_end DATE,
    IN p_batch INT
)
BEGIN
    DECLARE rows1 INT DEFAULT 1;
    DECLARE rows2 INT DEFAULT 1;
    DECLARE rows3 INT DEFAULT 1;
    DECLARE rows4 INT DEFAULT 1;
    DECLARE rows5 INT DEFAULT 1;
    DECLARE rows6 INT DEFAULT 1;
    DECLARE rows7 INT DEFAULT 1;
    DECLARE rows8 INT DEFAULT 1;
    DECLARE rows9 INT DEFAULT 1;

    -- disable safe updates
    SET @old_sql_safe_updates = @@sql_safe_updates;
    SET SQL_SAFE_UPDATES = 0;

    WHILE (rows1 + rows2 + rows3 + rows4 + rows5 + rows6 + rows7 + rows8 + rows9) > 0 DO

        DELETE FROM shopify_orders
        WHERE created_date BETWEEN p_start AND p_end
        LIMIT p_batch;
        SET rows1 = ROW_COUNT();

        DELETE FROM shopify_orders_update
        WHERE created_date BETWEEN p_start AND p_end
        LIMIT p_batch;
        SET rows2 = ROW_COUNT();

        DELETE FROM order_summary
        WHERE date BETWEEN p_start AND p_end
        LIMIT p_batch;
        SET rows3 = ROW_COUNT();

        DELETE FROM sales_summary
        WHERE date BETWEEN p_start AND p_end
        LIMIT p_batch;
        SET rows4 = ROW_COUNT();

        DELETE FROM gross_summary
        WHERE date BETWEEN p_start AND p_end
        LIMIT p_batch;
        SET rows5 = ROW_COUNT();

        DELETE FROM discount_summary
        WHERE date BETWEEN p_start AND p_end
        LIMIT p_batch;
        SET rows6 = ROW_COUNT();

        DELETE FROM hour_wise_sales
        WHERE date BETWEEN p_start AND p_end
        LIMIT p_batch;
        SET rows7 = ROW_COUNT();

        DELETE FROM overall_summary
        WHERE date BETWEEN p_start AND p_end
        LIMIT p_batch;
        SET rows8 = ROW_COUNT();

        DELETE FROM returns_fact
        WHERE event_date BETWEEN p_start AND p_end
        LIMIT p_batch;
        SET rows9 = ROW_COUNT();

        -- progress output
        SELECT CONCAT('Deleted batch from ', p_start, ' to ', p_end) AS status,
               rows1 AS shopify_orders,
               rows2 AS shopify_orders_update,
               rows3 AS order_summary,
               rows4 AS sales_summary,
               rows5 AS gross_summary,
               rows6 AS discount_summary,
               rows7 AS hour_wise_sales,
               rows8 AS overall_summary,
               rows9 AS returns_fact;

    END WHILE;

    -- restore safe updates
    SET SQL_SAFE_UPDATES = @old_sql_safe_updates;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-04-22 13:53:18
