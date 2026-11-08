# **Substrate-Dependent Effects of Ionic Silver on Lettuce Performance and Root Microbiome in Bio-Generative Life Support Systems: A Retrospective Analysis of NASA Study OSD-723**

This repository contains a retrospective analysis of the NASA Open Science Data Repository (OSDR) dataset **OSD-723** (O’Rourke et al.). The analysis evaluates the efficacy of ionic silver (Ag+) as a biocide for space agriculture, specifically looking at its substrate-dependent phytotoxicity and effects on root-associated microbiomes in *Lactuca sativa* cv. 'Outredgeous'.

# **Overview**

In long-duration space missions, bio-generative life support systems (BLSS) are critical for sustainable food production and cabin atmosphere management. However, microgravity-induced water stagnation promotes opportunistic pathogens. While ionic silver (Ag+) is used as a potable water disinfectant on the ISS, applying it to irrigation systems raises concerns about plant health.

This study analyzes data from OSD-723 to understand how two different growth media—inert rockwool hydroponics and calcined clay arcillite—buffer silver phytotoxicity and affect temporal microbial dynamics over a 28-day growth cycle.

# **Key Findings**

* **Substrate Buffering is Crucial:** Rockwool hydroponic systems exhibit severe phytotoxicity and stunting at low silver concentrations (31 ppb), whereas clay-based arcillite systems provide physical and geochemical buffering that protects the plants from silver-induced stress.  
* **Microbial Rebound & Resistance:** Although ionic silver initially reduces microbial loads, root metagenomic sequencing shows a significant microbial rebound by Day 28 across all dosing levels, indicating the rapid selection of silver-tolerant microbial strains.  
* **Design Limitations (Asymmetrical Sampling):** Missing longitudinal samples in the arcillite system (especially root samples at Days 7, 14, and 21\) introduce statistical barriers. The README suggests using Linear Mixed-Effects Models (LMMs) to handle these unbalanced designs.

# **Methodology & Statistical Modeling**

Due to the asymmetrical sampling structure (sampling gaps in clay roots and temporal shoot markers), traditional repeated-measures ANOVA is prone to high data exclusion rates. This project implements Linear Mixed-Effects Models (LMMs) to:

* Retain all available unbalanced observations without listwise deletion.  
* Partition variance into fixed effects (silver concentration, substrate type) and random effects (plant ID, batch/run).  
* Model temporal growth trajectories despite gaps.

# **Data Provenance**

All underlying data is publicly available on the [NASA Open Science Data Repository (OSDR)](https://osdr.nasa.gov/bio/repo/data/studies/OSD-723) under study accession number **OSD-723**: *"Substrate Matters: Ionic Silver Alters Lettuce Growth, Nutrient Uptake, and Root Microbiome in a Hydroponics System"*.

# **Author & Citation**

* **Author:** Stacey Mahuna (smahuna@gmail.com)  
* **Paper Title:** *Substrate-Dependent Effects of Ionic Silver on Lettuce Performance and Root Microbiome in Bio-Generative Life Support Systems: A Retrospective Analysis of NASA Study OSD-723*

