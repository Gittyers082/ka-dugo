-- MySQL dump 10.13  Distrib 8.0.44, for Win64 (x86_64)
--
-- Host: localhost    Database: kadugo_db
-- ------------------------------------------------------
-- Server version	8.4.7

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `account`
--
CREATE DATABASE IF NOT EXISTS kadugo_db DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE kadugo_db;

DROP TABLE IF EXISTS `account`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `account` (
  `account_id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('donor','bank','organizer','phlebotomist','admin') COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint NOT NULL DEFAULT '1',
  `last_login` datetime DEFAULT NULL,
  PRIMARY KEY (`account_id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `account`
--

LOCK TABLES `account` WRITE;
/*!40000 ALTER TABLE `account` DISABLE KEYS */;
INSERT INTO `account` VALUES (1,'admin@kadugo.org','$2y$10$GZY0R0eS1lg/GB3sAnSYyuVW.6/diJglZvdt2Nj2ucZUD/q8vtgGm','admin',1,'2026-10-15 08:30:00'),(2,'redcross.cavite@org.ph','$2y$10$GZY0R0eS1lg/GB3sAnSYyuVW.6/diJglZvdt2Nj2ucZUD/q8vtgGm','organizer',1,'2026-10-16 09:15:00'),(3,'trece.bloodbank@kadugo.org','$2y$10$GZY0R0eS1lg/GB3sAnSYyuVW.6/diJglZvdt2Nj2ucZUD/q8vtgGm','bank',1,'2026-10-16 10:00:00'),(4,'phleb.juan@kadugo.org','$2y$10$GZY0R0eS1lg/GB3sAnSYyuVW.6/diJglZvdt2Nj2ucZUD/q8vtgGm','phlebotomist',1,'2026-10-14 14:20:00'),(5,'miguel.cruz@gmail.com','$2y$10$GZY0R0eS1lg/GB3sAnSYyuVW.6/diJglZvdt2Nj2ucZUD/q8vtgGm','donor',1,'2026-10-16 11:45:00'),(6,'ana.reyes@gmail.com','$2y$10$GZY0R0eS1lg/GB3sAnSYyuVW.6/diJglZvdt2Nj2ucZUD/q8vtgGm','donor',1,NULL);
/*!40000 ALTER TABLE `account` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `alert`
--

DROP TABLE IF EXISTS `alert`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `alert` (
  `alert_id` int NOT NULL AUTO_INCREMENT,
  `sender_type` enum('system','bank','organizer') COLLATE utf8mb4_unicode_ci NOT NULL,
  `bank_id` int DEFAULT NULL,
  `organizer_id` int DEFAULT NULL,
  `request_id` int DEFAULT NULL,
  `drive_id` int DEFAULT NULL,
  `blood_type_id` tinyint NOT NULL,
  `level` tinyint NOT NULL DEFAULT '1',
  `message` varchar(280) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('draft','active','completed','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `sent_at` datetime DEFAULT NULL,
  PRIMARY KEY (`alert_id`),
  KEY `fk_alert_bank` (`bank_id`),
  KEY `fk_alert_organizer` (`organizer_id`),
  KEY `fk_alert_request` (`request_id`),
  KEY `fk_alert_drive` (`drive_id`),
  KEY `fk_alert_blood_type` (`blood_type_id`),
  CONSTRAINT `fk_alert_bank` FOREIGN KEY (`bank_id`) REFERENCES `blood_bank` (`bank_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_alert_blood_type` FOREIGN KEY (`blood_type_id`) REFERENCES `blood_type` (`blood_type_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_alert_drive` FOREIGN KEY (`drive_id`) REFERENCES `drive` (`drive_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_alert_organizer` FOREIGN KEY (`organizer_id`) REFERENCES `organizer` (`organizer_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_alert_request` FOREIGN KEY (`request_id`) REFERENCES `blood_request` (`request_id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `alert`
--

LOCK TABLES `alert` WRITE;
/*!40000 ALTER TABLE `alert` DISABLE KEYS */;
INSERT INTO `alert` VALUES (1,'bank',1,NULL,1,NULL,7,2,'CRITICAL: O+ blood needed urgently at Trece Martires Central Blood Bank. Please respond if eligible!','active','2026-10-16 12:00:00');
/*!40000 ALTER TABLE `alert` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `alert_recipient`
--

DROP TABLE IF EXISTS `alert_recipient`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `alert_recipient` (
  `alert_id` int NOT NULL,
  `donor_id` int NOT NULL,
  `is_read` tinyint NOT NULL DEFAULT '0',
  `responded_at` datetime DEFAULT NULL,
  `channel` enum('push','sms','email') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `delivery_status` enum('pending','sent','failed') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`alert_id`,`donor_id`),
  KEY `fk_ar_donor` (`donor_id`),
  CONSTRAINT `fk_ar_alert` FOREIGN KEY (`alert_id`) REFERENCES `alert` (`alert_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ar_donor` FOREIGN KEY (`donor_id`) REFERENCES `donor` (`donor_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `alert_recipient`
--

LOCK TABLES `alert_recipient` WRITE;
/*!40000 ALTER TABLE `alert_recipient` DISABLE KEYS */;
INSERT INTO `alert_recipient` VALUES (1,1,1,'2026-10-16 12:05:00','push','sent'),(1,2,0,NULL,'sms','sent');
/*!40000 ALTER TABLE `alert_recipient` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `blood_bank`
--

DROP TABLE IF EXISTS `blood_bank`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `blood_bank` (
  `bank_id` int NOT NULL AUTO_INCREMENT,
  `organizer_id` int NOT NULL,
  `account_id` int DEFAULT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `address` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `latitude` decimal(9,6) NOT NULL,
  `longitude` decimal(9,6) NOT NULL,
  `contact_no` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `daily_quota_units` int NOT NULL,
  PRIMARY KEY (`bank_id`),
  UNIQUE KEY `account_id` (`account_id`),
  KEY `fk_bank_organizer` (`organizer_id`),
  CONSTRAINT `fk_bank_account` FOREIGN KEY (`account_id`) REFERENCES `account` (`account_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_bank_organizer` FOREIGN KEY (`organizer_id`) REFERENCES `organizer` (`organizer_id`) ON DELETE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `blood_bank`
--

LOCK TABLES `blood_bank` WRITE;
/*!40000 ALTER TABLE `blood_bank` DISABLE KEYS */;
INSERT INTO `blood_bank` VALUES (1,1,3,'Trece Martires Central Blood Bank','Capitol Compound, Trece Martires City, Cavite',14.281600,120.868200,'+63464191234',50);
/*!40000 ALTER TABLE `blood_bank` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `blood_component`
--

DROP TABLE IF EXISTS `blood_component`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `blood_component` (
  `component_id` tinyint NOT NULL AUTO_INCREMENT,
  `name` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`component_id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `blood_component`
--

LOCK TABLES `blood_component` WRITE;
/*!40000 ALTER TABLE `blood_component` DISABLE KEYS */;
INSERT INTO `blood_component` VALUES (4,'Fresh Frozen Plasma'),(2,'Packed Red Blood Cells'),(3,'Platelets'),(1,'Whole Blood');
/*!40000 ALTER TABLE `blood_component` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `blood_history`
--

DROP TABLE IF EXISTS `blood_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `blood_history` (
  `history_id` int NOT NULL AUTO_INCREMENT,
  `public_ref` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `donor_id` int NOT NULL,
  `donation_id` int DEFAULT NULL,
  `alert_id` int DEFAULT NULL,
  `blood_type_id` tinyint NOT NULL,
  `units` decimal(4,2) NOT NULL DEFAULT '1.00',
  `donated_on` date NOT NULL,
  `source` enum('system','manual') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'system',
  `verification` enum('pending','verified','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  PRIMARY KEY (`history_id`),
  UNIQUE KEY `public_ref` (`public_ref`),
  UNIQUE KEY `donation_id` (`donation_id`),
  KEY `fk_history_donor` (`donor_id`),
  KEY `fk_history_alert` (`alert_id`),
  KEY `fk_history_blood_type` (`blood_type_id`),
  CONSTRAINT `fk_history_alert` FOREIGN KEY (`alert_id`) REFERENCES `alert` (`alert_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_history_blood_type` FOREIGN KEY (`blood_type_id`) REFERENCES `blood_type` (`blood_type_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_history_donation` FOREIGN KEY (`donation_id`) REFERENCES `donation` (`donation_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_history_donor` FOREIGN KEY (`donor_id`) REFERENCES `donor` (`donor_id`) ON DELETE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `blood_history`
--

LOCK TABLES `blood_history` WRITE;
/*!40000 ALTER TABLE `blood_history` DISABLE KEYS */;
INSERT INTO `blood_history` VALUES (1,'f98a3124-7d9b-5e4f-0ca5-22b3939c5678',1,1,1,7,1.00,'2026-06-10','system','verified');
/*!40000 ALTER TABLE `blood_history` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `blood_request`
--

DROP TABLE IF EXISTS `blood_request`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `blood_request` (
  `request_id` int NOT NULL AUTO_INCREMENT,
  `bank_id` int NOT NULL,
  `blood_type_id` tinyint NOT NULL,
  `component_id` tinyint NOT NULL,
  `ward` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `units_needed` int NOT NULL,
  `urgency` enum('normal','high','critical') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'normal',
  `needed_by` datetime NOT NULL,
  `status` enum('open','fulfilled','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  PRIMARY KEY (`request_id`),
  KEY `fk_request_bank` (`bank_id`),
  KEY `fk_request_blood_type` (`blood_type_id`),
  KEY `fk_request_component` (`component_id`),
  CONSTRAINT `fk_request_bank` FOREIGN KEY (`bank_id`) REFERENCES `blood_bank` (`bank_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_request_blood_type` FOREIGN KEY (`blood_type_id`) REFERENCES `blood_type` (`blood_type_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_request_component` FOREIGN KEY (`component_id`) REFERENCES `blood_component` (`component_id`) ON DELETE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `blood_request`
--

LOCK TABLES `blood_request` WRITE;
/*!40000 ALTER TABLE `blood_request` DISABLE KEYS */;
INSERT INTO `blood_request` VALUES (1,1,7,2,'Ward 4B - ER Trauma',4,'critical','2026-10-18 18:00:00','open');
/*!40000 ALTER TABLE `blood_request` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `blood_type`
--

DROP TABLE IF EXISTS `blood_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `blood_type` (
  `blood_type_id` tinyint NOT NULL AUTO_INCREMENT,
  `code` varchar(3) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`blood_type_id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `blood_type`
--

LOCK TABLES `blood_type` WRITE;
/*!40000 ALTER TABLE `blood_type` DISABLE KEYS */;
INSERT INTO `blood_type` VALUES (2,'A-'),(1,'A+'),(6,'AB-'),(5,'AB+'),(4,'B-'),(3,'B+'),(8,'O-'),(7,'O+');
/*!40000 ALTER TABLE `blood_type` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `donation`
--

DROP TABLE IF EXISTS `donation`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `donation` (
  `donation_id` int NOT NULL AUTO_INCREMENT,
  `client_uuid` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `donor_id` int NOT NULL,
  `bank_id` int NOT NULL,
  `drive_id` int DEFAULT NULL,
  `request_id` int DEFAULT NULL,
  `blood_type_id` tinyint NOT NULL,
  `component_id` tinyint NOT NULL,
  `phlebotomist_id` int DEFAULT NULL,
  `units` decimal(4,2) NOT NULL DEFAULT '1.00',
  `collected_at` datetime NOT NULL,
  `status` enum('collected','tested','processed','discarded','transfused') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'collected',
  PRIMARY KEY (`donation_id`),
  UNIQUE KEY `client_uuid` (`client_uuid`),
  KEY `fk_donation_donor` (`donor_id`),
  KEY `fk_donation_bank` (`bank_id`),
  KEY `fk_donation_drive` (`drive_id`),
  KEY `fk_donation_request` (`request_id`),
  KEY `fk_donation_blood_type` (`blood_type_id`),
  KEY `fk_donation_component` (`component_id`),
  KEY `fk_donation_phlebotomist` (`phlebotomist_id`),
  CONSTRAINT `fk_donation_bank` FOREIGN KEY (`bank_id`) REFERENCES `blood_bank` (`bank_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_donation_blood_type` FOREIGN KEY (`blood_type_id`) REFERENCES `blood_type` (`blood_type_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_donation_component` FOREIGN KEY (`component_id`) REFERENCES `blood_component` (`component_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_donation_donor` FOREIGN KEY (`donor_id`) REFERENCES `donor` (`donor_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_donation_drive` FOREIGN KEY (`drive_id`) REFERENCES `drive` (`drive_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_donation_phlebotomist` FOREIGN KEY (`phlebotomist_id`) REFERENCES `phlebotomist` (`phlebotomist_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_donation_request` FOREIGN KEY (`request_id`) REFERENCES `blood_request` (`request_id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `donation`
--

LOCK TABLES `donation` WRITE;
/*!40000 ALTER TABLE `donation` DISABLE KEYS */;
INSERT INTO `donation` VALUES (1,'e87b2123-6c8a-4d3e-9bf4-11a2828b4567',1,1,NULL,1,7,2,1,1.00,'2026-06-10 10:30:00','transfused');
/*!40000 ALTER TABLE `donation` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `donor`
--

DROP TABLE IF EXISTS `donor`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `donor` (
  `donor_id` int NOT NULL AUTO_INCREMENT,
  `account_id` int DEFAULT NULL,
  `full_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `birthdate` date NOT NULL,
  `sex` enum('male','female') COLLATE utf8mb4_unicode_ci NOT NULL,
  `weight_kg` decimal(5,2) NOT NULL,
  `contact_no` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `blood_type_id` tinyint NOT NULL,
  `latitude` decimal(9,6) DEFAULT NULL,
  `longitude` decimal(9,6) DEFAULT NULL,
  `last_donation_date` date DEFAULT NULL,
  `qr_code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `photo_path` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`donor_id`),
  UNIQUE KEY `qr_code` (`qr_code`),
  UNIQUE KEY `account_id` (`account_id`),
  KEY `fk_donor_blood_type` (`blood_type_id`),
  CONSTRAINT `fk_donor_account` FOREIGN KEY (`account_id`) REFERENCES `account` (`account_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_donor_blood_type` FOREIGN KEY (`blood_type_id`) REFERENCES `blood_type` (`blood_type_id`) ON DELETE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `donor`
--

LOCK TABLES `donor` WRITE;
/*!40000 ALTER TABLE `donor` DISABLE KEYS */;
INSERT INTO `donor` VALUES (1,5,'Miguel Cruz','1995-06-15','male',72.50,'+639189876543',7,14.285500,120.864200,'2026-06-10','DNR-QR-99238471209384','/uploads/donors/miguel.jpg'),(2,6,'Ana Reyes','2000-03-22','female',54.00,'+639201112233',1,14.281000,120.869000,NULL,'DNR-QR-11223344556677',NULL);
/*!40000 ALTER TABLE `donor` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `donor_deferral`
--

DROP TABLE IF EXISTS `donor_deferral`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `donor_deferral` (
  `deferral_id` int NOT NULL AUTO_INCREMENT,
  `donor_id` int NOT NULL,
  `reason` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `starts_on` date NOT NULL,
  `ends_on` date DEFAULT NULL,
  PRIMARY KEY (`deferral_id`),
  KEY `fk_deferral_donor` (`donor_id`),
  CONSTRAINT `fk_deferral_donor` FOREIGN KEY (`donor_id`) REFERENCES `donor` (`donor_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `donor_deferral`
--

LOCK TABLES `donor_deferral` WRITE;
/*!40000 ALTER TABLE `donor_deferral` DISABLE KEYS */;
INSERT INTO `donor_deferral` VALUES (1,2,'Low Hemoglobin Level','2026-09-01','2026-11-01');
/*!40000 ALTER TABLE `donor_deferral` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `drive`
--

DROP TABLE IF EXISTS `drive`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `drive` (
  `drive_id` int NOT NULL AUTO_INCREMENT,
  `organizer_id` int NOT NULL,
  `bank_id` int DEFAULT NULL,
  `ref_code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `venue` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `drive_date` date NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `slots_total` int NOT NULL,
  `category` enum('community','corporate','university') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'community',
  `status` enum('scheduled','ongoing','completed','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'scheduled',
  PRIMARY KEY (`drive_id`),
  UNIQUE KEY `ref_code` (`ref_code`),
  KEY `fk_drive_organizer` (`organizer_id`),
  KEY `fk_drive_bank` (`bank_id`),
  CONSTRAINT `fk_drive_bank` FOREIGN KEY (`bank_id`) REFERENCES `blood_bank` (`bank_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_drive_organizer` FOREIGN KEY (`organizer_id`) REFERENCES `organizer` (`organizer_id`) ON DELETE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `drive`
--

LOCK TABLES `drive` WRITE;
/*!40000 ALTER TABLE `drive` DISABLE KEYS */;
INSERT INTO `drive` VALUES (1,1,1,'DRV-2026-001','Cavite Community Blood Drive','Trece Martires City Hall','2026-11-05','08:00:00','16:00:00',64,'community','scheduled');
/*!40000 ALTER TABLE `drive` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `drive_blood_type`
--

DROP TABLE IF EXISTS `drive_blood_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `drive_blood_type` (
  `drive_id` int NOT NULL,
  `blood_type_id` tinyint NOT NULL,
  PRIMARY KEY (`drive_id`,`blood_type_id`),
  KEY `fk_dbt_blood_type` (`blood_type_id`),
  CONSTRAINT `fk_dbt_blood_type` FOREIGN KEY (`blood_type_id`) REFERENCES `blood_type` (`blood_type_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_dbt_drive` FOREIGN KEY (`drive_id`) REFERENCES `drive` (`drive_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `drive_blood_type`
--

LOCK TABLES `drive_blood_type` WRITE;
/*!40000 ALTER TABLE `drive_blood_type` DISABLE KEYS */;
INSERT INTO `drive_blood_type` VALUES (1,1),(1,3),(1,7),(1,8);
/*!40000 ALTER TABLE `drive_blood_type` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `drive_registration`
--

DROP TABLE IF EXISTS `drive_registration`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `drive_registration` (
  `registration_id` int NOT NULL AUTO_INCREMENT,
  `drive_id` int NOT NULL,
  `donor_id` int NOT NULL,
  `slot_id` int NOT NULL,
  `component_id` tinyint NOT NULL,
  `status` enum('booked','checked_in','completed','cancelled','no_show') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'booked',
  `checked_in_at` datetime DEFAULT NULL,
  PRIMARY KEY (`registration_id`),
  KEY `fk_reg_drive` (`drive_id`),
  KEY `fk_reg_donor` (`donor_id`),
  KEY `fk_reg_slot` (`slot_id`),
  KEY `fk_reg_component` (`component_id`),
  CONSTRAINT `fk_reg_component` FOREIGN KEY (`component_id`) REFERENCES `blood_component` (`component_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_reg_donor` FOREIGN KEY (`donor_id`) REFERENCES `donor` (`donor_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_reg_drive` FOREIGN KEY (`drive_id`) REFERENCES `drive` (`drive_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_reg_slot` FOREIGN KEY (`slot_id`) REFERENCES `drive_slot` (`slot_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `drive_registration`
--

LOCK TABLES `drive_registration` WRITE;
/*!40000 ALTER TABLE `drive_registration` DISABLE KEYS */;
INSERT INTO `drive_registration` VALUES (1,1,1,1,1,'booked',NULL);
/*!40000 ALTER TABLE `drive_registration` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `drive_slot`
--

DROP TABLE IF EXISTS `drive_slot`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `drive_slot` (
  `slot_id` int NOT NULL AUTO_INCREMENT,
  `drive_id` int NOT NULL,
  `slot_time` time NOT NULL,
  `capacity` int NOT NULL,
  PRIMARY KEY (`slot_id`),
  KEY `fk_slot_drive` (`drive_id`),
  CONSTRAINT `fk_slot_drive` FOREIGN KEY (`drive_id`) REFERENCES `drive` (`drive_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `drive_slot`
--

LOCK TABLES `drive_slot` WRITE;
/*!40000 ALTER TABLE `drive_slot` DISABLE KEYS */;
INSERT INTO `drive_slot` VALUES (1,1,'08:00:00',4),(2,1,'08:30:00',4),(3,1,'09:00:00',4);
/*!40000 ALTER TABLE `drive_slot` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `organizer`
--

DROP TABLE IF EXISTS `organizer`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `organizer` (
  `organizer_id` int NOT NULL AUTO_INCREMENT,
  `account_id` int DEFAULT NULL,
  `org_code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `org_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `contact_person` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `contact_no` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`organizer_id`),
  UNIQUE KEY `org_code` (`org_code`),
  UNIQUE KEY `account_id` (`account_id`),
  CONSTRAINT `fk_organizer_account` FOREIGN KEY (`account_id`) REFERENCES `account` (`account_id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `organizer`
--

LOCK TABLES `organizer` WRITE;
/*!40000 ALTER TABLE `organizer` DISABLE KEYS */;
INSERT INTO `organizer` VALUES (1,2,'PRC-CAV','Philippine Red Cross Cavite Chapter','Dr. Jose Santos','+639171234567');
/*!40000 ALTER TABLE `organizer` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `phlebotomist`
--

DROP TABLE IF EXISTS `phlebotomist`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `phlebotomist` (
  `phlebotomist_id` int NOT NULL AUTO_INCREMENT,
  `bank_id` int NOT NULL,
  `account_id` int DEFAULT NULL,
  `full_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cert_no` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`phlebotomist_id`),
  UNIQUE KEY `account_id` (`account_id`),
  KEY `fk_phlebotomist_bank` (`bank_id`),
  CONSTRAINT `fk_phlebotomist_account` FOREIGN KEY (`account_id`) REFERENCES `account` (`account_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_phlebotomist_bank` FOREIGN KEY (`bank_id`) REFERENCES `blood_bank` (`bank_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `phlebotomist`
--

LOCK TABLES `phlebotomist` WRITE;
/*!40000 ALTER TABLE `phlebotomist` DISABLE KEYS */;
INSERT INTO `phlebotomist` VALUES (1,1,4,'Juan Dela Cruz, RMT','PRC-RMT-0098234');
/*!40000 ALTER TABLE `phlebotomist` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-10-17  9:01:10
