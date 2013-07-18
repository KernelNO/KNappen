﻿/*
Author:       Mike Adair madairATdmsolutions.ca
              Richard Greenwood rich@greenwoodmap.com
License:      MIT as per: ../LICENSE

$Id: Proj.js 2956 2007-07-09 12:17:52Z steven $
*/

/**
 * Namespace: proj4
 *
 * Proj4js is a JavaScript library to transform point coordinates from one 
 * coordinate system to another, including datum transformations.
 *
 * This library is a port of both the Proj.4 and GCTCP C libraries to JavaScript. 
 * Enabling these transformations in the browser allows geographic data stored 
 * in different projections to be combined in browser-based web mapping 
 * applications.
 * 
 * Proj4js must have access to coordinate system initialization strings (which
 * are the same as for PROJ.4 command line).  Thes can be included in your 
 * application using a <script> tag or Proj4js can load CS initialization 
 * strings from a local directory or a web service such as spatialreference.org.
 *
 * Similarly, Proj4js must have access to projection transform code.  These can
 * be included individually using a <script> tag in your page, built into a 
 * custom build of Proj4js or loaded dynamically at run-time.  Using the
 * -combined and -compressed versions of Proj4js includes all projection class
 * code by default.
 *
 * All coordinates are handled as points which have a .x and a .y property
 * which will be modified in place.
 *
 * Override proj4.reportError for output of alerts and warnings.
 *
 * See http://trac.osgeo.org/proj4js/wiki/UserGuide for full details.
*/

/**
 * Global namespace object for proj4 library
 */
function proj4(fromProj,toProj,coord){
  var transformer = function(f,t,c){
    var transformedArray;
    if(Array.isArray(c)){
      transformedArray = proj4.transform(f,t,new proj4.Point(c));
      if(c.length === 3){
        return [transformedArray.x, transformedArray.y, transformedArray.z];
      }else{
        return [transformedArray.x, transformedArray.y];
      }
    }else{
      return proj4.transform(fromProj,toProj,c);
    }
  };
  
  fromProj = fromProj instanceof proj4.Proj ? fromProj : new proj4.Proj(fromProj);
  if(typeof toProj === 'undefined'){
    toProj = fromProj;
    fromProj = proj4.WGS84;
  }else if(typeof toProj === 'string'){
    toProj = new proj4.Proj(toProj);
  }else if(toProj.x||Array.isArray(toProj)){
    coord = toProj;
    toProj = fromProj;
    fromProj = proj4.WGS84;
  }else{
    toProj = toProj instanceof proj4.Proj ? toProj : new proj4.Proj(toProj);
  }
  if(coord){
    return transformer(fromProj,toProj,coord);
  } else {
    return {
      forward: function(coords){
        return transformer(fromProj,toProj,coords);
      },
      inverse: function(coords){
        return transformer(toProj,fromProj,coords);
      }
    };
  }
}
    /**
     * Property: defaultDatum
     * The datum to use when no others a specified
     */
proj4.defaultDatum = 'WGS84';                  //default datum

    /** 
    * Method: transform(source, dest, point)
    * Transform a point coordinate from one map projection to another.  This is
    * really the only public method you should need to use.
    *
    * Parameters:
    * source - {proj4.Proj} source map projection for the transformation
    * dest - {proj4.Proj} destination map projection for the transformation
    * point - {Object} point to transform, may be geodetic (long, lat) or
    *     projected Cartesian (x,y), but should always have x,y properties.
    */
proj4.transform = function(source, dest, point) {
  var wgs84;

  function checkNotWGS(source,dest){
    return ((source.datum.datum_type === proj4.common.PJD_3PARAM || source.datum.datum_type === proj4.common.PJD_7PARAM) && dest.datumCode !== "WGS84");
  }
  
  // Workaround for datum shifts towgs84, if either source or destination projection is not wgs84
  if (source.datum && dest.datum && (checkNotWGS(source, dest) ||checkNotWGS(dest,source))) {
    wgs84 = proj4.WGS84;
    this.transform(source, wgs84, point);
    source = wgs84;
  }
  // DGR, 2010/11/12
  if (source.axis!=="enu") {
    this.adjust_axis(source,false,point);
  }
  // Transform source points to long/lat, if they aren't already.
  if (source.projName==="longlat") {
    point.x *= proj4.common.D2R;  // convert degrees to radians
    point.y *= proj4.common.D2R;
  } else {
    if (source.to_meter) {
      point.x *= source.to_meter;
      point.y *= source.to_meter;
    }
    source.inverse(point); // Convert Cartesian to longlat
  }
  // Adjust for the prime meridian if necessary
  if (source.from_greenwich) {
    point.x += source.from_greenwich;
  }

  // Convert datums if needed, and if possible.
  point = this.datum_transform( source.datum, dest.datum, point );

  // Adjust for the prime meridian if necessary
  if (dest.from_greenwich) {
    point.x -= dest.from_greenwich;
  }

  if (dest.projName==="longlat") {
    // convert radians to decimal degrees
    point.x *= proj4.common.R2D;
    point.y *= proj4.common.R2D;
  } else {               // else project
    dest.forward(point);
    if (dest.to_meter) {
      point.x /= dest.to_meter;
      point.y /= dest.to_meter;
    }
  }

  // DGR, 2010/11/12
  if (dest.axis!=="enu") {
    this.adjust_axis(dest,true,point);
  }

  return point;
}; // transform()

    /** datum_transform()
      source coordinate system definition,
      destination coordinate system definition,
      point to transform in geodetic coordinates (long, lat, height)
    */
proj4.datum_transform = function( source, dest, point ) {
  var wp,i,l;
  function checkParams(fallback){
    return (fallback === proj4.common.PJD_3PARAM || fallback === proj4.common.PJD_7PARAM);
  }
  // Short cut if the datums are identical.
  if( source.compare_datums( dest ) ) {
    return point; // in this case, zero is sucess,
    // whereas cs_compare_datums returns 1 to indicate TRUE
    // confusing, should fix this
  }

  // Explicitly skip datum transform by setting 'datum=none' as parameter for either source or dest
  if( source.datum_type === proj4.common.PJD_NODATUM || dest.datum_type === proj4.common.PJD_NODATUM) {
    return point;
  }

  //DGR: 2012-07-29 : add nadgrids support (begin)
  var src_a = source.a;
  var src_es = source.es;

  var dst_a = dest.a;
  var dst_es = dest.es;

  var fallback= source.datum_type;
  // If this datum requires grid shifts, then apply it to geodetic coordinates.
  if( fallback === proj4.common.PJD_GRIDSHIFT ) {
    if (this.apply_gridshift( source, 0, point )===0) {
      source.a = proj4.common.SRS_WGS84_SEMIMAJOR;
      source.es = proj4.common.SRS_WGS84_ESQUARED;
    } else {
      // try 3 or 7 params transformation or nothing ?
      if (!source.datum_params) {
        source.a = src_a;
        source.es = source.es;
        return point;
      }
      wp= 1;
      for (i= 0, l= source.datum_params.length; i<l; i++) {
        wp*= source.datum_params[i];
      }
      if (wp===0) {
        source.a = src_a;
        source.es = source.es;
        return point;
      }
      if(source.datum_params.length>3){
        fallback = proj4.common.PJD_7PARAM;
      } else {
        fallback = proj4.common.PJD_3PARAM;
      }
    }
  }
  if( dest.datum_type === proj4.common.PJD_GRIDSHIFT ){
    dest.a = proj4.common.SRS_WGS84_SEMIMAJOR;
    dest.es = proj4.common.SRS_WGS84_ESQUARED;
  }
   // Do we need to go through geocentric coordinates?
  if (source.es !== dest.es || source.a !== dest.a || checkParams(fallback) || checkParams(dest.datum_type)) {
    //DGR: 2012-07-29 : add nadgrids support (end)
    // Convert to geocentric coordinates.
    source.geodetic_to_geocentric( point );
    // CHECK_RETURN;
    // Convert between datums
    if(checkParams(source.datum_type)) {
      source.geocentric_to_wgs84(point);
      // CHECK_RETURN;
    }
    if(checkParams(dest.datum_type)) {
      dest.geocentric_from_wgs84(point);
      // CHECK_RETURN;
    }
    // Convert back to geodetic coordinates
    dest.geocentric_to_geodetic( point );
    // CHECK_RETURN;
  }
  // Apply grid shift to destination if required
  if( dest.datum_type === proj4.common.PJD_GRIDSHIFT ) {
    this.apply_gridshift( dest, 1, point);
    // CHECK_RETURN;
  }

  source.a = src_a;
  source.es = src_es;
  dest.a = dst_a;
  dest.es = dst_es;

  return point;
}; // cs_datum_transform

    /**
     * This is the real workhorse, given a gridlist
     * DGR: 2012-07-29 addition based on proj4 trunk
     */
proj4.apply_gridshift = function(srs,inverse,point) {
  var i,l,gi,ct,epsilon;
  if (srs.grids===null || srs.grids.length===0) {
    return -38;//are these error codes?
  }
  var input= {"x":point.x, "y":point.y};
  var output= {"x":Number.NaN, "y":Number.NaN};
  /* keep trying till we find a table that works */
  var onlyMandatoryGrids= false;
  for (i = 0, l = srs.grids.length; i<l; i++) {
    gi= srs.grids[i];
    onlyMandatoryGrids= gi.mandatory;
    ct= gi.grid;
    if (ct===null) {
      if (gi.mandatory) {
        this.reportError("unable to find '"+gi.name+"' grid.");
        return -48;//are these error codes?
      }
      continue;//optional grid
    }
    /* skip tables that don't match our point at all.  */
    epsilon= (Math.abs(ct.del[1])+Math.abs(ct.del[0]))/10000;
    if( ct.ll[1]-epsilon>input.y || ct.ll[0]-epsilon>input.x || ct.ll[1]+(ct.lim[1]-1)*ct.del[1]+epsilon<input.y || ct.ll[0]+(ct.lim[0]-1)*ct.del[0]+epsilon<input.x ) {
      continue;
    }
    /* If we have child nodes, check to see if any of them apply. */
    /* TODO : only plain grid has been implemented ... */
    /* we found a more refined child node to use */
    /* load the grid shift info if we don't have it. */
    /* TODO : proj4.grids pre-loaded (as they can be huge ...) */
    /* skip numerical computing error when "null" grid (identity grid): */
    if (gi.name==="null") {
      output.x= input.x;
      output.y= input.y;
    } else {
      output= proj4.common.nad_cvt(input, inverse, ct);
    }
    if (!isNaN(output.x)) {
      break;
    }
  }
  if (isNaN(output.x)) {
    if (!onlyMandatoryGrids) {
      this.reportError("failed to find a grid shift table for location '"+
        input.x*proj4.common.R2D+" "+input.y*proj4.common.R2D+
        " tried: '"+srs.nadgrids+"'");
      return -48;
    }
    return -1;//FIXME: no shift applied ...
  }
  point.x= output.x;
  point.y= output.y;
  return 0;
};

    /**
     * Function: adjust_axis
     * Normalize or de-normalized the x/y/z axes.  The normal form is "enu"
     * (easting, northing, up).
     * Parameters:
     * crs {proj4.Proj} the coordinate reference system
     * denorm {Boolean} when false, normalize
     * point {Object} the coordinates to adjust
     */
proj4.adjust_axis = function(crs, denorm, point) {
  var xin= point.x, yin= point.y, zin= point.z || 0.0;
  var v, t, i;
  for (i= 0; i<3; i++) {
    if (denorm && i===2 && point.z===undefined) {
      continue;
    }
    if (i===0) {
      v= xin;
      t= 'x';
    } else if (i===1) {
      v= yin;
      t= 'y';
    } else {
      v= zin;
      t= 'z';
    }
    switch(crs.axis[i]) {
    case 'e':
      point[t]= v;
      break;
    case 'w':
      point[t]= -v;
      break;
    case 'n':
      point[t]= v;
      break;
    case 's':
      point[t]= -v;
      break;
    case 'u':
      if (point[t]!==undefined) {
        point.z= v;
      }
      break;
    case 'd':
      if (point[t]!==undefined) {
        point.z= -v;
      }
      break;
    default :
      //console.log("ERROR: unknow axis ("+crs.axis[i]+") - check definition of "+crs.projName);
      return null;
    }
  }
  return point;
};

    /**
     * Function: reportError
     * An internal method to report errors back to user. 
     * Override this in applications to report error messages or throw exceptions.
     */
proj4.reportError = function(/*msg*/) {
  //console.log(msg);
};

/**
 *
 * Title: Private Methods
 * The following properties and methods are intended for internal use only.
 *
 * This is a minimal implementation of JavaScript inheritance methods so that 
 * proj4 can be used as a stand-alone library.
 * These are copies of the equivalent OpenLayers methods at v2.7
 */
 
/**
 * Function: extend
 * Copy all properties of a source object to a destination object.  Modifies
 *     the passed in destination object.  Any properties on the source object
 *     that are set to undefined will not be (re)set on the destination object.
 *
 * Parameters:
 * destination - {Object} The object that will be modified
 * source - {Object} The object with properties to be set on the destination
 *
 * Returns:
 * {Object} The destination object.
 */
proj4.extend = function(destination, source) {
  destination = destination || {};
  var value,property;
  if(!source) {
    return destination;
  }
  for(property in source) {
    value = source[property];
    if(value !== undefined) {
      destination[property] = value;
    }
  }
  return destination;
};

/**
 * Constructor: Class
 * Base class used to construct all other classes. Includes support for 
 *     multiple inheritance. 
 *  
 */
proj4.Class = function() {
  var Class = function() {
    this.initialize.apply(this, arguments);
  };
  var extended = {};
  var parent,i;
  for(i=0; i<arguments.length; ++i) {
    if(typeof arguments[i] === "function") {
      // get the prototype of the superclass
      parent = arguments[i].prototype;
    } else {
      // in this case we're extending with the prototype
      parent = arguments[i];
    }
    proj4.extend(extended, parent);
  }
  Class.prototype = extended;
  return Class;
};

(function(){
  /*global module*/
  if(typeof module !== 'undefined'){
    module.exports = proj4;
  }
})();

proj4.common = {
  PI : 3.141592653589793238, //Math.PI,
  HALF_PI : 1.570796326794896619, //Math.PI*0.5,
  TWO_PI : 6.283185307179586477, //Math.PI*2,
  FORTPI : 0.78539816339744833,
  R2D : 57.29577951308232088,
  D2R : 0.01745329251994329577,
  SEC_TO_RAD : 4.84813681109535993589914102357e-6, /* SEC_TO_RAD = Pi/180/3600 */
  EPSLN : 1.0e-10,
  MAX_ITER : 20,
  // following constants from geocent.c
  COS_67P5 : 0.38268343236508977,  /* cosine of 67.5 degrees */
  AD_C : 1.0026000,                /* Toms region 1 constant */

  /* datum_type values */
  PJD_UNKNOWN  : 0,
  PJD_3PARAM   : 1,
  PJD_7PARAM   : 2,
  PJD_GRIDSHIFT: 3,
  PJD_WGS84    : 4,   // WGS84 or equivalent
  PJD_NODATUM  : 5,   // WGS84 or equivalent
  SRS_WGS84_SEMIMAJOR : 6378137,  // only used in grid shift transforms
  SRS_WGS84_ESQUARED : 0.006694379990141316, //DGR: 2012-07-29

  // ellipoid pj_set_ell.c
  SIXTH : 0.1666666666666666667, /* 1/6 */
  RA4   : 0.04722222222222222222, /* 17/360 */
  RA6   : 0.02215608465608465608, /* 67/3024 */
  RV4   : 0.06944444444444444444, /* 5/72 */
  RV6   : 0.04243827160493827160, /* 55/1296 */

// Function to compute the constant small m which is the radius of
//   a parallel of latitude, phi, divided by the semimajor axis.
// -----------------------------------------------------------------
  msfnz : function(eccent, sinphi, cosphi) {
    var con = eccent * sinphi;
    return cosphi/(Math.sqrt(1 - con * con));
  },

// Function to compute the constant small t for use in the forward
//   computations in the Lambert Conformal Conic and the Polar
//   Stereographic projections.
// -----------------------------------------------------------------
  tsfnz : function(eccent, phi, sinphi) {
    var con = eccent * sinphi;
    var com = 0.5 * eccent;
    con = Math.pow(((1 - con) / (1 + con)), com);
    return (Math.tan(0.5 * (this.HALF_PI - phi))/con);
  },

// Function to compute the latitude angle, phi2, for the inverse of the
//   Lambert Conformal Conic and Polar Stereographic projections.
// ----------------------------------------------------------------
  phi2z : function(eccent, ts) {
    var eccnth = 0.5 * eccent;
    var con, dphi;
    var phi = this.HALF_PI - 2 * Math.atan(ts);
    for (var i = 0; i <= 15; i++) {
      con = eccent * Math.sin(phi);
      dphi = this.HALF_PI - 2 * Math.atan(ts *(Math.pow(((1 - con)/(1 + con)),eccnth))) - phi;
      phi += dphi;
      if (Math.abs(dphi) <= 0.0000000001){
        return phi;
      }
    }
    //console.log("phi2z has NoConvergence");
    return -9999;
  },

/* Function to compute constant small q which is the radius of a 
   parallel of latitude, phi, divided by the semimajor axis. 
------------------------------------------------------------*/
  qsfnz : function(eccent,sinphi) {
    var con;
    if (eccent > 1.0e-7) {
      con = eccent * sinphi;
      return (( 1- eccent * eccent) * (sinphi /(1 - con * con) - (0.5/eccent)*Math.log((1 - con)/(1 + con))));
    } else {
      return(2 * sinphi);
    }
  },

/* Function to compute the inverse of qsfnz
------------------------------------------------------------*/
  iqsfnz : function (eccent, q) {
    var temp = 1-(1-eccent*eccent)/(2*eccent)*Math.log((1-eccent)/(1+eccent));
    if (Math.abs(Math.abs(q)-temp)<1.0E-6) {
      if (q<0) {
        return (-1*proj4.common.HALF_PI);
      } else {
        return proj4.common.HALF_PI;
      }
    }
    //var phi = 0.5* q/(1-eccent*eccent);
    var phi = Math.asin(0.5*q);
    var dphi;
    var sin_phi;
    var cos_phi;
    var con;
    for (var i=0;i<30;i++){
      sin_phi = Math.sin(phi);
      cos_phi = Math.cos(phi);
      con = eccent*sin_phi;
      dphi=Math.pow(1-con*con,2)/(2*cos_phi)*(q/(1-eccent*eccent)-sin_phi/(1-con*con)+0.5/eccent*Math.log((1-con)/(1+con)));
      phi+=dphi;
      if (Math.abs(dphi) <= 0.0000000001) {
        return phi;
      }
    }

    //console.log("IQSFN-CONV:Latitude failed to converge after 30 iterations");
    return NaN;
  },

/* Function to eliminate roundoff errors in asin
----------------------------------------------*/
  asinz : function(x) {
    if (Math.abs(x)>1) {
      x=(x>1)?1:-1;
    }
    return Math.asin(x);
  },

// following functions from gctpc cproj.c for transverse mercator projections
  e0fn : function(x) {return(1-0.25*x*(1+x/16*(3+1.25*x)));},
  e1fn : function(x) {return(0.375*x*(1+0.25*x*(1+0.46875*x)));},
  e2fn : function(x) {return(0.05859375*x*x*(1+0.75*x));},
  e3fn : function(x) {return(x*x*x*(35/3072));},
  mlfn : function(e0,e1,e2,e3,phi) {return(e0*phi-e1*Math.sin(2*phi)+e2*Math.sin(4*phi)-e3*Math.sin(6*phi));},
  imlfn : function(ml, e0, e1, e2, e3) {
    var phi;
    var dphi;

    phi=ml/e0;
    for (var i=0;i<15;i++){
      dphi=(ml-(e0*phi-e1*Math.sin(2*phi)+e2*Math.sin(4*phi)-e3*Math.sin(6*phi)))/(e0-2*e1*Math.cos(2*phi)+4*e2*Math.cos(4*phi)-6*e3*Math.cos(6*phi));
      phi+=dphi;
      if (Math.abs(dphi) <= 0.0000000001) {
        return phi;
      }
    }

    proj4.reportError("IMLFN-CONV:Latitude failed to converge after 15 iterations");
    return NaN;
  },

  srat : function(esinp, exp) {
    return(Math.pow((1-esinp)/(1+esinp), exp));
  },

// Function to return the sign of an argument
  sign : function(x) {
    if (x < 0){
      return(-1);
    } else {
      return(1);
    }
  },

// Function to adjust longitude to -180 to 180; input in radians
  adjust_lon : function(x) {
    x = (Math.abs(x) < this.PI) ? x: (x - (this.sign(x)*this.TWO_PI) );
    return x;
  },

// IGNF - DGR : algorithms used by IGN France

// Function to adjust latitude to -90 to 90; input in radians
  adjust_lat : function(x) {
    x= (Math.abs(x) < this.HALF_PI) ? x: (x - (this.sign(x)*this.PI) );
    return x;
  },

// Latitude Isometrique - close to tsfnz ...
  latiso : function(eccent, phi, sinphi) {
    if (Math.abs(phi) > this.HALF_PI){
      return Number.NaN;
    }
    if (phi===this.HALF_PI) {
      return Number.POSITIVE_INFINITY;
    }
    if (phi===-1*this.HALF_PI) {
      return Number.NEGATIVE_INFINITY;
    }

    var con = eccent*sinphi;
    return Math.log(Math.tan((this.HALF_PI+phi)/2))+eccent*Math.log((1-con)/(1+con))/2;
  },

  fL : function(x,L) {
    return 2*Math.atan(x*Math.exp(L)) - this.HALF_PI;
  },

// Inverse Latitude Isometrique - close to ph2z
  invlatiso : function(eccent, ts) {
    var phi= this.fL(1,ts);
    var Iphi= 0;
    var con= 0;
    do {
      Iphi= phi;
      con= eccent*Math.sin(Iphi);
      phi= this.fL(Math.exp(eccent*Math.log((1+con)/(1-con))/2),ts);
    } while (Math.abs(phi-Iphi)>1.0e-12);
    return phi;
  },

// Needed for Gauss Schreiber
// Original:  Denis Makarov (info@binarythings.com)
// Web Site:  http://www.binarythings.com
  sinh : function(x)
  {
    var r= Math.exp(x);
    r= (r-1/r)/2;
    return r;
  },

  cosh : function(x)
  {
    var r= Math.exp(x);
    r= (r+1/r)/2;
    return r;
  },

  tanh : function(x)
  {
    var r= Math.exp(x);
    r= (r-1/r)/(r+1/r);
    return r;
  },

  asinh : function(x)
  {
    var s= (x>= 0? 1:-1);
    return s*(Math.log( Math.abs(x) + Math.sqrt(x*x+1) ));
  },

  acosh : function(x)
  {
    return 2*Math.log(Math.sqrt((x+1)/2) + Math.sqrt((x-1)/2));
  },

  atanh : function(x)
  {
    return Math.log((x-1)/(x+1))/2;
  },

// Grande Normale
  gN : function(a,e,sinphi)
  {
    var temp= e*sinphi;
    return a/Math.sqrt(1 - temp*temp);
  },
  
  //code from the PROJ.4 pj_mlfn.c file;  this may be useful for other projections
  pj_enfn: function(es) {
    var en = [];
    en[0] = this.C00 - es * (this.C02 + es * (this.C04 + es * (this.C06 + es * this.C08)));
    en[1] = es * (this.C22 - es * (this.C04 + es * (this.C06 + es * this.C08)));
    var t = es * es;
    en[2] = t * (this.C44 - es * (this.C46 + es * this.C48));
    t *= es;
    en[3] = t * (this.C66 - es * this.C68);
    en[4] = t * es * this.C88;
    return en;
  },
  
  pj_mlfn: function(phi, sphi, cphi, en) {
    cphi *= sphi;
    sphi *= sphi;
    return(en[0] * phi - cphi * (en[1] + sphi*(en[2]+ sphi*(en[3] + sphi*en[4]))));
  },
  
  pj_inv_mlfn: function(arg, es, en) {
    var k = 1/(1-es);
    var phi = arg;
    for (var i = proj4.common.MAX_ITER; i ; --i) { /* rarely goes over 2 iterations */
      var s = Math.sin(phi);
      var t = 1 - es * s * s;
      //t = this.pj_mlfn(phi, s, Math.cos(phi), en) - arg;
      //phi -= t * (t * Math.sqrt(t)) * k;
      t = (this.pj_mlfn(phi, s, Math.cos(phi), en) - arg) * (t * Math.sqrt(t)) * k;
      phi -= t;
      if (Math.abs(t) < proj4.common.EPSLN) {
        return phi;
      }
    }
    proj4.reportError("cass:pj_inv_mlfn: Convergence error");
    return phi;
  },

  /**
   * Determine correction values
   * source: nad_intr.c (DGR: 2012-07-29)
   */
  nad_intr: function(pin,ct) {
    // force computation by decreasing by 1e-7 to be as closed as possible
    // from computation under C:C++ by leveraging rounding problems ...
    var t= {
      x:(pin.x-1.e-7)/ct.del[0],
      y:(pin.y-1e-7)/ct.del[1]
    };
    var indx= {
      x:Math.floor(t.x),
      y:Math.floor(t.y)
    };
    var frct= {
      x:t.x-1*indx.x,
      y:t.y-1*indx.y
    };
    var val= {
      x:Number.NaN,
      y:Number.NaN
    };
    var inx;
    if (indx.x<0) {
      if (!(indx.x===-1 && frct.x>0.99999999999)) {
        return val;
      }
      ++indx.x;
      frct.x= 0;
    } else {
      inx= indx.x+1;
      if (inx>=ct.lim[0]) {
        if (!(inx===ct.lim[0] && frct.x<1e-11)) {
          return val;
        }
        --indx.x;
        frct.x= 1;
      }
    }
    if (indx.y<0) {
      if (!(indx.y===-1 && frct.y>0.99999999999)) {
        return val;
      }
      ++indx.y;
      frct.y= 0;
    } else {
      inx = indx.y+1;
      if (inx>=ct.lim[1]) {
        if (!(inx === ct.lim[1] && frct.y<1e-11)) {
          return val;
        }
        --indx.y;
        frct.y= 1;
      }
    }
    inx= (indx.y*ct.lim[0])+indx.x;
    var f00= {
      x:ct.cvs[inx][0],
      y:ct.cvs[inx][1]
    };
    inx++;
    var f10= {
      x:ct.cvs[inx][0],
      y:ct.cvs[inx][1]
    };
    inx+= ct.lim[0];
    var f11= {
      x:ct.cvs[inx][0],
      y:ct.cvs[inx][1]
    };
    inx--;
    var f01= {
      x:ct.cvs[inx][0],
      y:ct.cvs[inx][1]
    };
    var m11= frct.x*frct.y,
      m10= frct.x*(1-frct.y),
      m00= (1-frct.x)*(1-frct.y),
      m01= (1-frct.x)*frct.y;
    val.x= (m00*f00.x + m10*f10.x + m01*f01.x + m11*f11.x);
    val.y= (m00*f00.y + m10*f10.y + m01*f01.y + m11*f11.y);
    return val;
  },

  /**
   * Correct value
   * source: nad_cvt.c (DGR: 2012-07-29)
   */
  nad_cvt: function(pin,inverse,ct) {
    var val= {"x":Number.NaN, "y":Number.NaN};
    if (isNaN(pin.x)) { return val; }
    var tb= {"x":pin.x, "y":pin.y};
    tb.x-= ct.ll[0];
    tb.y-= ct.ll[1];
    tb.x= proj4.common.adjust_lon(tb.x - proj4.common.PI) + proj4.common.PI;
    var t= proj4.common.nad_intr(tb,ct);
    if (inverse) {
      if (isNaN(t.x)) {
        return val;
      }
      t.x= tb.x + t.x;
      t.y= tb.y - t.y;
      var i= 9, tol= 1e-12;
      var dif, del;
      do {
        del= proj4.common.nad_intr(t,ct);
        if (isNaN(del.x)) {
          this.reportError("Inverse grid shift iteration failed, presumably at grid edge.  Using first approximation.");
          break;
        }
        dif= {"x":t.x-del.x-tb.x, "y":t.y+del.y-tb.y};
        t.x-= dif.x;
        t.y-= dif.y;
      } while (i-- && Math.abs(dif.x)>tol && Math.abs(dif.y)>tol);
      if (i<0) {
        this.reportError("Inverse grid shift iterator failed to converge.");
        return val;
      }
      val.x= proj4.common.adjust_lon(t.x+ct.ll[0]);
      val.y= t.y+ct.ll[1];
    } else {
      if (!isNaN(t.x)) {
        val.x= pin.x - t.x;
        val.y= pin.y + t.y;
      }
    }
    return val;
  },

/* meridinal distance for ellipsoid and inverse
**    8th degree - accurate to < 1e-5 meters when used in conjuction
**		with typical major axis values.
**	Inverse determines phi to EPS (1e-11) radians, about 1e-6 seconds.
*/
  C00: 1,
  C02: 0.25,
  C04: 0.046875,
  C06: 0.01953125,
  C08: 0.01068115234375,
  C22: 0.75,
  C44: 0.46875,
  C46: 0.01302083333333333333,
  C48: 0.00712076822916666666,
  C66: 0.36458333333333333333,
  C68: 0.00569661458333333333,
  C88: 0.3076171875

};

/**
 * Class: proj4.Proj
 *
 * Proj objects provide transformation methods for point coordinates
 * between geodetic latitude/longitude and a projected coordinate system. 
 * once they have been initialized with a projection code.
 *
 * Initialization of Proj objects is with a projection code, usually EPSG codes,
 * which is the key that will be used with the proj4.defs array.
 * 
 * The code passed in will be stripped of colons and converted to uppercase
 * to locate projection definition files.
 *
 * A projection object has properties for units and title strings.
 */
proj4.Proj = proj4.Class({

  /**
   * Property: title
   * The title to describe the projection
   */
  title: null,

  /**
   * Property: projName
   * The projection class for this projection, e.g. lcc (lambert conformal conic,
   * or merc for mercator).  These are exactly equivalent to their Proj4 
   * counterparts.
   */
  projName: null,
  /**
   * Property: units
   * The units of the projection.  Values include 'm' and 'degrees'
   */
  units: null,
  /**
   * Property: datum
   * The datum specified for the projection
   */
  datum: null,
  /**
   * Property: x0
   * The x coordinate origin
   */
  x0: 0,
  /**
   * Property: y0
   * The y coordinate origin
   */
  y0: 0,
  /**
   * Property: localCS
   * Flag to indicate if the projection is a local one in which no transforms
   * are required.
   */
  localCS: false,

  /**
   * Property: queue
   * Buffer (FIFO) to hold callbacks waiting to be called when projection loaded.
   */
  queue: null,

  /**
   * Constructor: initialize
   * Constructor for proj4.Proj objects
   *
   * Parameters:
   * srsCode - a code for map projection definition parameters.  These are usually
   * (but not always) EPSG codes.
   */
  initialize: function(srsCode, callback) {
    this.srsCodeInput = srsCode;

    //Register callbacks prior to attempting to process definition
    this.queue = [];
    if (callback) {
      this.queue.push(callback);
    }

    //check to see if this is a WKT string
    if ((srsCode.indexOf('GEOGCS') >= 0) || (srsCode.indexOf('GEOCCS') >= 0) || (srsCode.indexOf('PROJCS') >= 0) || (srsCode.indexOf('LOCAL_CS') >= 0)) {
      this.parseWKT(srsCode);
      this.deriveConstants();
      //this.loadProjCode(this.projName);

    }
    else {

      // DGR 2008-08-03 : support urn and url
      if (srsCode.indexOf('urn:') === 0) {
        //urn:ORIGINATOR:def:crs:CODESPACE:VERSION:ID
        var urn = srsCode.split(':');
        if ((urn[1] === 'ogc' || urn[1] === 'x-ogc') && (urn[2] === 'def') && (urn[3] === 'crs')) {
          srsCode = urn[4] + ':' + urn[urn.length - 1];
        }
      }
      else if (srsCode.indexOf('http://') === 0) {
        //url#ID
        var url = srsCode.split('#');
        if (url[0].match(/epsg.org/)) {
          // http://www.epsg.org/#
          srsCode = 'EPSG:' + url[1];
        }
        else if (url[0].match(/RIG.xml/)) {
          //http://librairies.ign.fr/geoportail/resources/RIG.xml#
          //http://interop.ign.fr/registers/ign/RIG.xml#
          srsCode = 'IGNF:' + url[1];
        }
        else if (url[0].indexOf('/def/crs/') !== -1) {
          // http://www.opengis.net/def/crs/EPSG/0/code
          url = srsCode.split('/');
          srsCode = url.pop(); //code
          url.pop(); //version FIXME
          srsCode = url.pop() + ':' + srsCode; //authority
        }
      }
      this.srsCode = srsCode.toUpperCase();
      if (this.srsCode.indexOf("EPSG") === 0) {
        this.srsCode = this.srsCode;
        this.srsAuth = 'epsg';
        this.srsProjNumber = this.srsCode.substring(5);
        // DGR 2007-11-20 : authority IGNF
      }
      else if (this.srsCode.indexOf("IGNF") === 0) {
        this.srsCode = this.srsCode;
        this.srsAuth = 'IGNF';
        this.srsProjNumber = this.srsCode.substring(5);
        // DGR 2008-06-19 : pseudo-authority CRS for WMS
      }
      else if (this.srsCode.indexOf("CRS") === 0) {
        this.srsCode = this.srsCode;
        this.srsAuth = 'CRS';
        this.srsProjNumber = this.srsCode.substring(4);
      }
      else {
        this.srsAuth = '';
        this.srsProjNumber = this.srsCode;
      }

      this.parseDefs();
    }
    this.initTransforms();
  },

  /**
   * Function: initTransforms
   *    Finalize the initialization of the Proj object
   *
   */
  initTransforms: function() {
    if (!(this.projName in proj4.Proj)) {
      throw ("unknown projection");
    }
    proj4.extend(this, proj4.Proj[this.projName]);
    this.init();
    if (this.queue) {
      var item;
      while ((item = this.queue.shift())) {
        item.call(this, this);
      }
    }
  },

  /**
   * Function: parseWKT
   * Parses a WKT string to get initialization parameters
   *
   */
  wktRE: /^(\w+)\[(.*)\]$/,
  parseWKT: function(wkt) {
    var wktMatch = wkt.match(this.wktRE);
    if (!wktMatch){
      return;
    }
    var wktObject = wktMatch[1];
    var wktContent = wktMatch[2];
    var wktTemp = wktContent.split(",");
    var wktName;
    if (wktObject.toUpperCase() === "TOWGS84") {
      wktName = wktObject; //no name supplied for the TOWGS84 array
    }
    else {
      wktName = wktTemp.shift();
    }
    wktName = wktName.replace(/^\"/, "");
    wktName = wktName.replace(/\"$/, "");

    /*
    wktContent = wktTemp.join(",");
    var wktArray = wktContent.split("],");
    for (var i=0; i<wktArray.length-1; ++i) {
      wktArray[i] += "]";
    }
    */

    var wktArray = [];
    var bkCount = 0;
    var obj = "";
    for (var i = 0; i < wktTemp.length; ++i) {
      var token = wktTemp[i];
      for (var j2 = 0; j2 < token.length; ++j2) {
        if (token.charAt(j2) === "["){
          ++bkCount;
        }
        if (token.charAt(j2) === "]"){
          --bkCount;
        }
      }
      obj += token;
      if (bkCount === 0) {
        wktArray.push(obj);
        obj = "";
      }
      else {
        obj += ",";
      }
    }

    //this is grotesque -cwm
    var name, value;
    switch (wktObject) {
    case 'LOCAL_CS':
      this.projName = 'identity';
      this.localCS = true;
      this.srsCode = wktName;
      break;
    case 'GEOGCS':
      this.projName = 'longlat';
      this.geocsCode = wktName;
      if (!this.srsCode){
        this.srsCode = wktName;
      }
      break;
    case 'PROJCS':
      this.srsCode = wktName;
      break;
    case 'GEOCCS':
      break;
    case 'PROJECTION':
      this.projName = proj4.wktProjections[wktName];
      break;
    case 'DATUM':
      this.datumName = wktName;
      break;
    case 'LOCAL_DATUM':
      this.datumCode = 'none';
      break;
    case 'SPHEROID':
      this.ellps = wktName;
      this.a = parseFloat(wktArray.shift());
      this.rf = parseFloat(wktArray.shift());
      break;
    case 'PRIMEM':
      this.from_greenwich = parseFloat(wktArray.shift()); //to radians?
      break;
    case 'UNIT':
      this.units = wktName;
      this.unitsPerMeter = parseFloat(wktArray.shift());
      break;
    case 'PARAMETER':
      name = wktName.toLowerCase();
      value = parseFloat(wktArray.shift());
      //there may be many variations on the wktName values, add in case
      //statements as required
      switch (name) {
      case 'false_easting':
        this.x0 = value;
        break;
      case 'false_northing':
        this.y0 = value;
        break;
      case 'scale_factor':
        this.k0 = value;
        break;
      case 'central_meridian':
        this.long0 = value * proj4.common.D2R;
        break;
      case 'latitude_of_origin':
        this.lat0 = value * proj4.common.D2R;
        break;
      case 'more_here':
        break;
      default:
        break;
      }
      break;
    case 'TOWGS84':
      this.datum_params = wktArray;
      break;
      //DGR 2010-11-12: AXIS
    case 'AXIS':
      name = wktName.toLowerCase();
      value = wktArray.shift();
      switch (value) {
      case 'EAST':
        value = 'e';
        break;
      case 'WEST':
        value = 'w';
        break;
      case 'NORTH':
        value = 'n';
        break;
      case 'SOUTH':
        value = 's';
        break;
      case 'UP':
        value = 'u';
        break;
      case 'DOWN':
        value = 'd';
        break;
        //case 'OTHER': 
      default:
        value = ' ';
        break; //FIXME
      }
      if (!this.axis) {
        this.axis = "enu";
      }
      switch (name) {
      case 'x':
        this.axis = value + this.axis.substr(1, 2);
        break;
      case 'y':
        this.axis = this.axis.substr(0, 1) + value + this.axis.substr(2, 1);
        break;
      case 'z':
        this.axis = this.axis.substr(0, 2) + value;
        break;
      default:
        break;
      }
      break;
    case 'MORE_HERE':
      break;
    default:
      break;
    }
    for (var j = 0; j < wktArray.length; ++j) {
      this.parseWKT(wktArray[j]);
    }
  },

  /**
   * Function: parseDefs
   * Parses the PROJ.4 initialization string and sets the associated properties.
   *
   */
  parseDefs: function() {
    this.defData = proj4.defs[this.srsCode];
    if (!this.defData) {
      return;
    }
    var key;
    for(key in this.defData){
      this[key]=this.defData[key];
    }
    this.deriveConstants();
  },

  /**
   * Function: deriveConstants
   * Sets several derived constant values and initialization of datum and ellipse
   *     parameters.
   *
   */
  deriveConstants: function() {
    // DGR 2011-03-20 : nagrids -> nadgrids
    if (this.nadgrids && this.nadgrids.length === 0) {
      this.nadgrids = null;
    }
    if (this.nadgrids) {
      this.grids = this.nadgrids.split(",");
      var g = null,
        l = this.grids.length;
      if (l > 0) {
        for (var i = 0; i < l; i++) {
          g = this.grids[i];
          var fg = g.split("@");
          if (fg[fg.length - 1] === "") {
            proj4.reportError("nadgrids syntax error '" + this.nadgrids + "' : empty grid found");
            continue;
          }
          this.grids[i] = {
            mandatory: fg.length === 1, //@=> optional grid (no error if not found)
            name: fg[fg.length - 1],
            grid: proj4.grids[fg[fg.length - 1]] //FIXME: grids loading ...
          };
          if (this.grids[i].mandatory && !this.grids[i].grid) {
            proj4.reportError("Missing '" + this.grids[i].name + "'");
          }
        }
      }
      // DGR, 2011-03-20: grids is an array of objects that hold
      // the loaded grids, its name and the mandatory informations of it.
    }
    if (this.datumCode && this.datumCode !== 'none') {
      var datumDef = proj4.Datum[this.datumCode];
      if (datumDef) {
        this.datum_params = datumDef.towgs84 ? datumDef.towgs84.split(',') : null;
        this.ellps = datumDef.ellipse;
        this.datumName = datumDef.datumName ? datumDef.datumName : this.datumCode;
      }
    }
    if (!this.a) { // do we have an ellipsoid?
      var ellipse = proj4.Ellipsoid[this.ellps] ? proj4.Ellipsoid[this.ellps] : proj4.Ellipsoid.WGS84;
      proj4.extend(this, ellipse);
    }
    if (this.rf && !this.b){
      this.b = (1.0 - 1.0 / this.rf) * this.a;
    }
    if (this.rf === 0 || Math.abs(this.a - this.b) < proj4.common.EPSLN) {
      this.sphere = true;
      this.b = this.a;
    }
    this.a2 = this.a * this.a; // used in geocentric
    this.b2 = this.b * this.b; // used in geocentric
    this.es = (this.a2 - this.b2) / this.a2; // e ^ 2
    this.e = Math.sqrt(this.es); // eccentricity
    if (this.R_A) {
      this.a *= 1 - this.es * (proj4.common.SIXTH + this.es * (proj4.common.RA4 + this.es * proj4.common.RA6));
      this.a2 = this.a * this.a;
      this.b2 = this.b * this.b;
      this.es = 0;
    }
    this.ep2 = (this.a2 - this.b2) / this.b2; // used in geocentric
    if (!this.k0){
      this.k0 = 1.0; //default value
    }
    //DGR 2010-11-12: axis
    if (!this.axis) {
      this.axis = "enu";
    }

    this.datum = new proj4.datum(this);
  }
});

proj4.Proj.longlat = {
  init: function() {
    //no-op for longlat
  },
  forward: function(pt) {
    //identity transform
    return pt;
  },
  inverse: function(pt) {
    //identity transform
    return pt;
  }
};
proj4.Proj.identity = proj4.Proj.longlat;

/**
  proj4.defs is a collection of coordinate system definition objects in the 
  PROJ.4 command line format.
  Generally a def is added by means of a separate .js file for example:

    <SCRIPT type="text/javascript" src="defs/EPSG26912.js"></SCRIPT>

  def is a CS definition in PROJ.4 WKT format, for example:
    +proj="tmerc"   //longlat, etc.
    +a=majorRadius
    +b=minorRadius
    +lat0=somenumber
    +long=somenumber
*/

proj4.defs = function(name) {
  /*global console*/
  var defData;
  if(arguments.length === 2){
    defData = arguments[1];
  }else if(arguments.length===1){
    if(Array.isArray(name)){
      return name.map(function(v){
        if(Array.isArray(v)){
          proj4.defs.apply(proj4,v);
        }else{
          proj4.defs(v);
        }
      });
    }else if(typeof name === 'string'){
      
    }else if('EPSG' in name){
      proj4.defs['EPSG:'+name.EPSG]=name;
    }else if('ESRI' in name){
      proj4.defs['ESRI:'+name.ESRI]=name;
    }else if('IAU2000' in name){
      proj4.defs['IAU2000:'+name.IAU2000]=name;
    }else{
      console.log(name);
    }
    return;
  }
  var self = {};
  var nameSplit;
  if (name.indexOf(":") > -1) {
    nameSplit = name.split(":");
    self[nameSplit[0]] = nameSplit[1];
  }
  var paramObj = {};
  defData.split("+").map(function(v) {
    return v.trim();
  }).filter(function(a) {
    return a;
  }).forEach(function(a) {
    var split = a.split("=");
    if (split[1] === "@null") {
      return;
    }
    split.push(true);
    paramObj[split[0].toLowerCase()] = split[1];
  });
  var paramName, paramVal, paramOutname;
  var params = {
    proj: 'projName',
    datum: 'datumCode',
    rf: function(v) {
      self.rf = parseFloat(v, 10);
    },
    lat_0: function(v) {
      self.lat0 = v * proj4.common.D2R;
    },
    lat_1: function(v) {
      self.lat1 = v * proj4.common.D2R;
    },
    lat_2: function(v) {
      self.lat2 = v * proj4.common.D2R;
    },
    lat_ts: function(v) {
      self.lat_ts = v * proj4.common.D2R;
    },
    lon_0: function(v) {
      self.long0 = v * proj4.common.D2R;
    },
    lon_1: function(v) {
      self.long1 = v * proj4.common.D2R;
    },
    lon_2: function(v) {
      self.long2 = v * proj4.common.D2R;
    },
    alpha: function(v) {
      self.alpha = parseFloat(v) * proj4.common.D2R;
    },
    lonc: function(v) {
      self.longc = v * proj4.common.D2R;
    },
    x_0: function(v) {
      self.x0 = parseFloat(v, 10);
    },
    y_0: function(v) {
      self.y0 = parseFloat(v, 10);
    },
    k_0: function(v) {
      self.k0 = parseFloat(v, 10);
    },
    k: function(v) {
      self.k0 = parseFloat(v, 10);
    },
    r_a: function() {
      self.R_A = true;
    },
    zone: function(v) {
      self.zone = parseInt(v, 10);
    },
    south: function() {
      self.utmSouth = true;
    },
    towgs84: function(v) {
      self.datum_params = v.split(",").map(function(a) {
        return parseFloat(a, 10);
      });
    },
    to_meter: function(v) {
      self.to_meter = parseFloat(v, 10);
    },
    from_greenwich: function(v) {
      self.from_greenwich = v * proj4.common.D2R;
    },
    pm: function(v) {
      self.from_greenwich = (proj4.PrimeMeridian[v] ? proj4.PrimeMeridian[v] : parseFloat(v, 10)) * proj4.common.D2R;
    },
    axis: function(v) {
      var legalAxis = "ewnsud";
      if (v.length === 3 && legalAxis.indexOf(v.substr(0, 1)) !== -1 && legalAxis.indexOf(v.substr(1, 1)) !== -1 && legalAxis.indexOf(v.substr(2, 1)) !== -1) {
        self.axis = v;
      }
    }
  };
  for (paramName in paramObj) {
    paramVal = paramObj[paramName];
    if (paramName in params) {
      paramOutname = params[paramName];
      if (typeof paramOutname === 'function') {
        paramOutname(paramVal);
      }
      else {
        self[paramOutname] = paramVal;
      }
    }
    else {
      self[paramName] = paramVal;
    }
  }
  proj4.defs[name] = self;
};
proj4.defToJson = function(str){
  return JSON.stringify(proj4.defs[str]);
};

//generated by https://github.com/calvinmetcalf/node-proj4js-defs
//data from http://svn.osgeo.org/metacrs/proj/trunk/proj/nad/epsg
proj4.defs([{"EPSG":"3819","projName":"longlat","ellps":"bessel","datum_params":[595.48,121.69,515.35,4.115,-2.9383,0.853,-3.408],"no_defs":true},{"EPSG":"3821","projName":"longlat","ellps":"aust_SA","no_defs":true},{"EPSG":"3824","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"3889","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"3906","projName":"longlat","ellps":"bessel","datum_params":[682,-203,480,0,0,0,0],"no_defs":true},{"EPSG":"4001","projName":"longlat","ellps":"airy","no_defs":true},{"EPSG":"4002","projName":"longlat","ellps":"mod_airy","no_defs":true},{"EPSG":"4003","projName":"longlat","ellps":"aust_SA","no_defs":true},{"EPSG":"4004","projName":"longlat","ellps":"bessel","no_defs":true},{"EPSG":"4005","projName":"longlat","a":"6377492.018","b":"6356173.508712696","no_defs":true},{"EPSG":"4006","projName":"longlat","ellps":"bess_nam","no_defs":true},{"EPSG":"4007","projName":"longlat","a":"6378293.645208759","b":"6356617.987679838","no_defs":true},{"EPSG":"4008","projName":"longlat","ellps":"clrk66","no_defs":true},{"EPSG":"4009","projName":"longlat","a":"6378450.047548896","b":"6356826.621488444","no_defs":true},{"EPSG":"4010","projName":"longlat","a":"6378300.789","b":"6356566.435","no_defs":true},{"EPSG":"4011","projName":"longlat","a":"6378249.2","b":"6356515","no_defs":true},{"EPSG":"4012","projName":"longlat","ellps":"clrk80","no_defs":true},{"EPSG":"4013","projName":"longlat","a":"6378249.145","b":"6356514.966398753","no_defs":true},{"EPSG":"4014","projName":"longlat","a":"6378249.2","b":"6356514.996941779","no_defs":true},{"EPSG":"4015","projName":"longlat","a":"6377276.345","b":"6356075.41314024","no_defs":true},{"EPSG":"4016","projName":"longlat","ellps":"evrstSS","no_defs":true},{"EPSG":"4018","projName":"longlat","a":"6377304.063","b":"6356103.038993155","no_defs":true},{"EPSG":"4019","projName":"longlat","ellps":"GRS80","no_defs":true},{"EPSG":"4020","projName":"longlat","ellps":"helmert","no_defs":true},{"EPSG":"4021","projName":"longlat","a":"6378160","b":"6356774.50408554","no_defs":true},{"EPSG":"4022","projName":"longlat","ellps":"intl","no_defs":true},{"EPSG":"4023","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4024","projName":"longlat","ellps":"krass","no_defs":true},{"EPSG":"4025","projName":"longlat","ellps":"WGS66","no_defs":true},{"EPSG":"4027","projName":"longlat","a":"6376523","b":"6355862.933255573","no_defs":true},{"EPSG":"4028","projName":"longlat","a":"6378298.3","b":"6356657.142669561","no_defs":true},{"EPSG":"4029","projName":"longlat","a":"6378300","b":"6356751.689189189","no_defs":true},{"EPSG":"4030","projName":"longlat","ellps":"WGS84","no_defs":true},{"EPSG":"4031","projName":"longlat","ellps":"WGS84","no_defs":true},{"EPSG":"4032","projName":"longlat","a":"6378136.2","b":"6356751.516927429","no_defs":true},{"EPSG":"4033","projName":"longlat","a":"6378136.3","b":"6356751.616592146","no_defs":true},{"EPSG":"4034","projName":"longlat","a":"6378249.144808011","b":"6356514.966204134","no_defs":true},{"EPSG":"4035","projName":"longlat","a":"6371000","b":"6371000","no_defs":true},{"EPSG":"4036","projName":"longlat","ellps":"GRS67","no_defs":true},{"EPSG":"4041","projName":"longlat","a":"6378135","b":"6356750.304921594","no_defs":true},{"EPSG":"4042","projName":"longlat","a":"6377299.36559538","b":"6356098.359005156","no_defs":true},{"EPSG":"4043","projName":"longlat","ellps":"WGS72","no_defs":true},{"EPSG":"4044","projName":"longlat","a":"6377301.243","b":"6356100.230165384","no_defs":true},{"EPSG":"4045","projName":"longlat","a":"6377299.151","b":"6356098.145120132","no_defs":true},{"EPSG":"4046","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4047","projName":"longlat","a":"6371007","b":"6371007","no_defs":true},{"EPSG":"4052","projName":"longlat","a":"6370997","b":"6370997","no_defs":true},{"EPSG":"4053","projName":"longlat","a":"6371228","b":"6371228","no_defs":true},{"EPSG":"4054","projName":"longlat","a":"6378273","b":"6356889.449","no_defs":true},{"EPSG":"4055","projName":"longlat","a":"6378137","b":"6378137","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4075","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4081","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4120","projName":"longlat","ellps":"bessel","no_defs":true},{"EPSG":"4121","projName":"longlat","datumCode":"GGRS87","no_defs":true},{"EPSG":"4122","projName":"longlat","a":"6378135","b":"6356750.304921594","no_defs":true},{"EPSG":"4123","projName":"longlat","ellps":"intl","datum_params":[-96.062,-82.428,-121.753,4.801,0.345,-1.376,1.496],"no_defs":true},{"EPSG":"4124","projName":"longlat","ellps":"bessel","datum_params":[414.1,41.3,603.1,-0.855,2.141,-7.023,0],"no_defs":true},{"EPSG":"4125","projName":"longlat","ellps":"bessel","datum_params":[-404.78,685.68,45.47,0,0,0,0],"no_defs":true},{"EPSG":"4126","projName":"longlat","ellps":"GRS80","no_defs":true},{"EPSG":"4127","projName":"longlat","ellps":"clrk66","datum_params":[-73.472,-51.66,-112.482,0.953,4.6,-2.368,0.586],"no_defs":true},{"EPSG":"4128","projName":"longlat","ellps":"clrk66","no_defs":true},{"EPSG":"4129","projName":"longlat","ellps":"clrk66","no_defs":true},{"EPSG":"4130","projName":"longlat","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4131","projName":"longlat","a":"6377276.345","b":"6356075.41314024","datum_params":[198,881,317,0,0,0,0],"no_defs":true},{"EPSG":"4132","projName":"longlat","ellps":"clrk80","datum_params":[-241.54,-163.64,396.06,0,0,0,0],"no_defs":true},{"EPSG":"4133","projName":"longlat","ellps":"GRS80","datum_params":[0.055,-0.541,-0.185,0.0183,-0.0003,-0.007,-0.014],"no_defs":true},{"EPSG":"4134","projName":"longlat","ellps":"clrk80","datum_params":[-180.624,-225.516,173.919,-0.81,-1.898,8.336,16.7101],"no_defs":true},{"EPSG":"4135","projName":"longlat","ellps":"clrk66","datum_params":[61,-285,-181,0,0,0,0],"no_defs":true},{"EPSG":"4136","projName":"longlat","ellps":"clrk66","no_defs":true},{"EPSG":"4137","projName":"longlat","ellps":"clrk66","no_defs":true},{"EPSG":"4138","projName":"longlat","ellps":"clrk66","no_defs":true},{"EPSG":"4139","projName":"longlat","ellps":"clrk66","datum_params":[11,72,-101,0,0,0,0],"no_defs":true},{"EPSG":"4140","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4141","projName":"longlat","ellps":"GRS80","datum_params":[-48,55,52,0,0,0,0],"no_defs":true},{"EPSG":"4142","projName":"longlat","ellps":"clrk80","datum_params":[-125,53,467,0,0,0,0],"no_defs":true},{"EPSG":"4143","projName":"longlat","ellps":"clrk80","datum_params":[-124.76,53,466.79,0,0,0,0],"no_defs":true},{"EPSG":"4144","projName":"longlat","a":"6377276.345","b":"6356075.41314024","datum_params":[214,804,268,0,0,0,0],"no_defs":true},{"EPSG":"4145","projName":"longlat","a":"6377301.243","b":"6356100.230165384","datum_params":[283,682,231,0,0,0,0],"no_defs":true},{"EPSG":"4146","projName":"longlat","a":"6377299.151","b":"6356098.145120132","datum_params":[295,736,257,0,0,0,0],"no_defs":true},{"EPSG":"4147","projName":"longlat","ellps":"krass","datum_params":[-17.51,-108.32,-62.39,0,0,0,0],"no_defs":true},{"EPSG":"4148","projName":"longlat","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4149","projName":"longlat","ellps":"bessel","datum_params":[674.4,15.1,405.3,0,0,0,0],"no_defs":true},{"EPSG":"4150","projName":"longlat","ellps":"bessel","datum_params":[674.374,15.056,405.346,0,0,0,0],"no_defs":true},{"EPSG":"4151","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4152","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4153","projName":"longlat","ellps":"intl","datum_params":[-133.63,-157.5,-158.62,0,0,0,0],"no_defs":true},{"EPSG":"4154","projName":"longlat","ellps":"intl","datum_params":[-117,-132,-164,0,0,0,0],"no_defs":true},{"EPSG":"4155","projName":"longlat","a":"6378249.2","b":"6356515","datum_params":[-83,37,124,0,0,0,0],"no_defs":true},{"EPSG":"4156","projName":"longlat","ellps":"bessel","datum_params":[589,76,480,0,0,0,0],"no_defs":true},{"EPSG":"4157","projName":"longlat","a":"6378293.645208759","b":"6356617.987679838","no_defs":true},{"EPSG":"4158","projName":"longlat","ellps":"intl","datum_params":[-0.465,372.095,171.736,0,0,0,0],"no_defs":true},{"EPSG":"4159","projName":"longlat","ellps":"intl","datum_params":[-115.854,-99.0583,-152.462,0,0,0,0],"no_defs":true},{"EPSG":"4160","projName":"longlat","ellps":"intl","no_defs":true},{"EPSG":"4161","projName":"longlat","ellps":"intl","datum_params":[27.5,14,186.4,0,0,0,0],"no_defs":true},{"EPSG":"4162","projName":"longlat","ellps":"bessel","no_defs":true},{"EPSG":"4163","projName":"longlat","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4164","projName":"longlat","ellps":"krass","datum_params":[-76,-138,67,0,0,0,0],"no_defs":true},{"EPSG":"4165","projName":"longlat","ellps":"intl","datum_params":[-173,253,27,0,0,0,0],"no_defs":true},{"EPSG":"4166","projName":"longlat","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4167","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4168","projName":"longlat","a":"6378300","b":"6356751.689189189","datum_params":[-199,32,322,0,0,0,0],"no_defs":true},{"EPSG":"4169","projName":"longlat","ellps":"clrk66","datum_params":[-115,118,426,0,0,0,0],"no_defs":true},{"EPSG":"4170","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4171","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4172","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4173","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4174","projName":"longlat","a":"6378300","b":"6356751.689189189","no_defs":true},{"EPSG":"4175","projName":"longlat","ellps":"clrk80","datum_params":[-88,4,101,0,0,0,0],"no_defs":true},{"EPSG":"4176","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4178","projName":"longlat","ellps":"krass","datum_params":[26,-121,-78,0,0,0,0],"no_defs":true},{"EPSG":"4179","projName":"longlat","ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"no_defs":true},{"EPSG":"4180","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4181","projName":"longlat","ellps":"intl","datum_params":[-189.681,18.3463,-42.7695,-0.33746,-3.09264,2.53861,0.4598],"no_defs":true},{"EPSG":"4182","projName":"longlat","ellps":"intl","datum_params":[-425,-169,81,0,0,0,0],"no_defs":true},{"EPSG":"4183","projName":"longlat","ellps":"intl","datum_params":[-104,167,-38,0,0,0,0],"no_defs":true},{"EPSG":"4184","projName":"longlat","ellps":"intl","datum_params":[-203,141,53,0,0,0,0],"no_defs":true},{"EPSG":"4185","projName":"longlat","ellps":"intl","no_defs":true},{"EPSG":"4188","projName":"longlat","ellps":"airy","datum_params":[482.5,-130.6,564.6,-1.042,-0.214,-0.631,8.15],"no_defs":true},{"EPSG":"4189","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4190","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4191","projName":"longlat","ellps":"krass","no_defs":true},{"EPSG":"4192","projName":"longlat","ellps":"intl","datum_params":[-206.1,-174.7,-87.7,0,0,0,0],"no_defs":true},{"EPSG":"4193","projName":"longlat","a":"6378249.2","b":"6356515","datum_params":[-70.9,-151.8,-41.4,0,0,0,0],"no_defs":true},{"EPSG":"4194","projName":"longlat","ellps":"intl","datum_params":[164,138,-189,0,0,0,0],"no_defs":true},{"EPSG":"4195","projName":"longlat","ellps":"intl","datum_params":[105,326,-102.5,0,0,0.814,-0.6],"no_defs":true},{"EPSG":"4196","projName":"longlat","ellps":"intl","datum_params":[-45,417,-3.5,0,0,0.814,-0.6],"no_defs":true},{"EPSG":"4197","projName":"longlat","ellps":"clrk80","no_defs":true},{"EPSG":"4198","projName":"longlat","ellps":"clrk80","no_defs":true},{"EPSG":"4199","projName":"longlat","ellps":"intl","no_defs":true},{"EPSG":"4200","projName":"longlat","ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"no_defs":true},{"EPSG":"4201","projName":"longlat","ellps":"clrk80","datum_params":[-166,-15,204,0,0,0,0],"no_defs":true},{"EPSG":"4202","projName":"longlat","ellps":"aust_SA","datum_params":[-117.808,-51.536,137.784,0.303,0.446,0.234,-0.29],"no_defs":true},{"EPSG":"4203","projName":"longlat","ellps":"aust_SA","datum_params":[-134,-48,149,0,0,0,0],"no_defs":true},{"EPSG":"4204","projName":"longlat","ellps":"intl","datum_params":[-143,-236,7,0,0,0,0],"no_defs":true},{"EPSG":"4205","projName":"longlat","ellps":"krass","datum_params":[-43,-163,45,0,0,0,0],"no_defs":true},{"EPSG":"4206","projName":"longlat","a":"6378249.2","b":"6356515","no_defs":true},{"EPSG":"4207","projName":"longlat","ellps":"intl","datum_params":[-304.046,-60.576,103.64,0,0,0,0],"no_defs":true},{"EPSG":"4208","projName":"longlat","ellps":"intl","datum_params":[-151.99,287.04,-147.45,0,0,0,0],"no_defs":true},{"EPSG":"4209","projName":"longlat","a":"6378249.145","b":"6356514.966398753","datum_params":[-143,-90,-294,0,0,0,0],"no_defs":true},{"EPSG":"4210","projName":"longlat","ellps":"clrk80","datum_params":[-160,-6,-302,0,0,0,0],"no_defs":true},{"EPSG":"4211","projName":"longlat","ellps":"bessel","datum_params":[-377,681,-50,0,0,0,0],"no_defs":true},{"EPSG":"4212","projName":"longlat","ellps":"clrk80","datum_params":[31.95,300.99,419.19,0,0,0,0],"no_defs":true},{"EPSG":"4213","projName":"longlat","a":"6378249.2","b":"6356515","datum_params":[-106,-87,188,0,0,0,0],"no_defs":true},{"EPSG":"4214","projName":"longlat","ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"no_defs":true},{"EPSG":"4215","projName":"longlat","ellps":"intl","no_defs":true},{"EPSG":"4216","projName":"longlat","ellps":"clrk66","datum_params":[-73,213,296,0,0,0,0],"no_defs":true},{"EPSG":"4218","projName":"longlat","ellps":"intl","datum_params":[307,304,-318,0,0,0,0],"no_defs":true},{"EPSG":"4219","projName":"longlat","ellps":"bessel","datum_params":[-384,664,-48,0,0,0,0],"no_defs":true},{"EPSG":"4220","projName":"longlat","ellps":"clrk80","datum_params":[-50.9,-347.6,-231,0,0,0,0],"no_defs":true},{"EPSG":"4221","projName":"longlat","ellps":"intl","datum_params":[-148,136,90,0,0,0,0],"no_defs":true},{"EPSG":"4222","projName":"longlat","a":"6378249.145","b":"6356514.966398753","datum_params":[-136,-108,-292,0,0,0,0],"no_defs":true},{"EPSG":"4223","projName":"longlat","datumCode":"carthage","no_defs":true},{"EPSG":"4224","projName":"longlat","ellps":"intl","datum_params":[-134,229,-29,0,0,0,0],"no_defs":true},{"EPSG":"4225","projName":"longlat","ellps":"intl","datum_params":[-206,172,-6,0,0,0,0],"no_defs":true},{"EPSG":"4226","projName":"longlat","a":"6378249.2","b":"6356515","no_defs":true},{"EPSG":"4227","projName":"longlat","a":"6378249.2","b":"6356515","datum_params":[-190.421,8.532,238.69,0,0,0,0],"no_defs":true},{"EPSG":"4228","projName":"longlat","a":"6378249.2","b":"6356515","no_defs":true},{"EPSG":"4229","projName":"longlat","ellps":"helmert","datum_params":[-130,110,-13,0,0,0,0],"no_defs":true},{"EPSG":"4230","projName":"longlat","ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"no_defs":true},{"EPSG":"4231","projName":"longlat","ellps":"intl","datum_params":[-83.11,-97.38,-117.22,0.00569291,-0.0446976,0.0442851,0.1218],"no_defs":true},{"EPSG":"4232","projName":"longlat","ellps":"clrk80","datum_params":[-346,-1,224,0,0,0,0],"no_defs":true},{"EPSG":"4233","projName":"longlat","ellps":"intl","datum_params":[-133,-321,50,0,0,0,0],"no_defs":true},{"EPSG":"4234","projName":"longlat","a":"6378249.2","b":"6356515","no_defs":true},{"EPSG":"4235","projName":"longlat","ellps":"intl","no_defs":true},{"EPSG":"4236","projName":"longlat","ellps":"intl","datum_params":[-637,-549,-203,0,0,0,0],"no_defs":true},{"EPSG":"4237","projName":"longlat","ellps":"GRS67","datum_params":[52.17,-71.82,-14.9,0,0,0,0],"no_defs":true},{"EPSG":"4238","projName":"longlat","a":"6378160","b":"6356774.50408554","datum_params":[-24,-15,5,0,0,0,0],"no_defs":true},{"EPSG":"4239","projName":"longlat","a":"6377276.345","b":"6356075.41314024","datum_params":[217,823,299,0,0,0,0],"no_defs":true},{"EPSG":"4240","projName":"longlat","a":"6377276.345","b":"6356075.41314024","datum_params":[210,814,289,0,0,0,0],"no_defs":true},{"EPSG":"4241","projName":"longlat","a":"6378249.144808011","b":"6356514.966204134","no_defs":true},{"EPSG":"4242","projName":"longlat","ellps":"clrk66","datum_params":[70,207,389.5,0,0,0,0],"no_defs":true},{"EPSG":"4243","projName":"longlat","a":"6377299.36559538","b":"6356098.359005156","no_defs":true},{"EPSG":"4244","projName":"longlat","a":"6377276.345","b":"6356075.41314024","datum_params":[-97,787,86,0,0,0,0],"no_defs":true},{"EPSG":"4245","projName":"longlat","a":"6377304.063","b":"6356103.038993155","datum_params":[-11,851,5,0,0,0,0],"no_defs":true},{"EPSG":"4246","projName":"longlat","ellps":"clrk80","datum_params":[-294.7,-200.1,525.5,0,0,0,0],"no_defs":true},{"EPSG":"4247","projName":"longlat","ellps":"intl","datum_params":[-273.5,110.6,-357.9,0,0,0,0],"no_defs":true},{"EPSG":"4248","projName":"longlat","ellps":"intl","datum_params":[-288,175,-376,0,0,0,0],"no_defs":true},{"EPSG":"4249","projName":"longlat","ellps":"intl","no_defs":true},{"EPSG":"4250","projName":"longlat","ellps":"clrk80","datum_params":[-130,29,364,0,0,0,0],"no_defs":true},{"EPSG":"4251","projName":"longlat","ellps":"clrk80","datum_params":[-90,40,88,0,0,0,0],"no_defs":true},{"EPSG":"4252","projName":"longlat","a":"6378249.2","b":"6356515","no_defs":true},{"EPSG":"4253","projName":"longlat","ellps":"clrk66","datum_params":[-133,-77,-51,0,0,0,0],"no_defs":true},{"EPSG":"4254","projName":"longlat","ellps":"intl","datum_params":[16,196,93,0,0,0,0],"no_defs":true},{"EPSG":"4255","projName":"longlat","ellps":"intl","datum_params":[-333,-222,114,0,0,0,0],"no_defs":true},{"EPSG":"4256","projName":"longlat","ellps":"clrk80","datum_params":[41,-220,-134,0,0,0,0],"no_defs":true},{"EPSG":"4257","projName":"longlat","ellps":"bessel","datum_params":[-587.8,519.75,145.76,0,0,0,0],"no_defs":true},{"EPSG":"4258","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4259","projName":"longlat","ellps":"intl","datum_params":[-254.1,-5.36,-100.29,0,0,0,0],"no_defs":true},{"EPSG":"4260","projName":"longlat","ellps":"clrk80","datum_params":[-70.9,-151.8,-41.4,0,0,0,0],"no_defs":true},{"EPSG":"4261","projName":"longlat","a":"6378249.2","b":"6356515","datum_params":[31,146,47,0,0,0,0],"no_defs":true},{"EPSG":"4262","projName":"longlat","ellps":"bessel","datum_params":[639,405,60,0,0,0,0],"no_defs":true},{"EPSG":"4263","projName":"longlat","ellps":"clrk80","datum_params":[-92,-93,122,0,0,0,0],"no_defs":true},{"EPSG":"4264","projName":"longlat","ellps":"intl","datum_params":[-252.95,-4.11,-96.38,0,0,0,0],"no_defs":true},{"EPSG":"4265","projName":"longlat","ellps":"intl","datum_params":[-104.1,-49.1,-9.9,0.971,-2.917,0.714,-11.68],"no_defs":true},{"EPSG":"4266","projName":"longlat","a":"6378249.2","b":"6356515","datum_params":[-74,-130,42,0,0,0,0],"no_defs":true},{"EPSG":"4267","projName":"longlat","datumCode":"NAD27","no_defs":true},{"EPSG":"4268","projName":"longlat","a":"6378450.047548896","b":"6356826.621488444","no_defs":true},{"EPSG":"4269","projName":"longlat","datumCode":"NAD83","no_defs":true},{"EPSG":"4270","projName":"longlat","ellps":"clrk80","datum_params":[-242.2,-144.9,370.3,0,0,0,0],"no_defs":true},{"EPSG":"4271","projName":"longlat","ellps":"intl","datum_params":[-10,375,165,0,0,0,0],"no_defs":true},{"EPSG":"4272","projName":"longlat","datumCode":"nzgd49","no_defs":true},{"EPSG":"4273","projName":"longlat","a":"6377492.018","b":"6356173.508712696","datum_params":[278.3,93,474.5,7.889,0.05,-6.61,6.21],"no_defs":true},{"EPSG":"4274","projName":"longlat","ellps":"intl","datum_params":[-223.237,110.193,36.649,0,0,0,0],"no_defs":true},{"EPSG":"4275","projName":"longlat","a":"6378249.2","b":"6356515","datum_params":[-168,-60,320,0,0,0,0],"no_defs":true},{"EPSG":"4276","projName":"longlat","ellps":"WGS66","no_defs":true},{"EPSG":"4277","projName":"longlat","datumCode":"OSGB36","no_defs":true},{"EPSG":"4278","projName":"longlat","ellps":"airy","no_defs":true},{"EPSG":"4279","projName":"longlat","ellps":"airy","no_defs":true},{"EPSG":"4280","projName":"longlat","ellps":"bessel","no_defs":true},{"EPSG":"4281","projName":"longlat","a":"6378300.789","b":"6356566.435","datum_params":[-275.722,94.7824,340.894,-8.001,-4.42,-11.821,1],"no_defs":true},{"EPSG":"4282","projName":"longlat","a":"6378249.2","b":"6356515","datum_params":[-148,51,-291,0,0,0,0],"no_defs":true},{"EPSG":"4283","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4284","projName":"longlat","ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"no_defs":true},{"EPSG":"4285","projName":"longlat","ellps":"intl","datum_params":[-128.16,-282.42,21.93,0,0,0,0],"no_defs":true},{"EPSG":"4286","projName":"longlat","ellps":"helmert","no_defs":true},{"EPSG":"4287","projName":"longlat","ellps":"intl","datum_params":[164,138,-189,0,0,0,0],"no_defs":true},{"EPSG":"4288","projName":"longlat","ellps":"intl","no_defs":true},{"EPSG":"4289","projName":"longlat","ellps":"bessel","datum_params":[565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725],"no_defs":true},{"EPSG":"4291","projName":"longlat","ellps":"GRS67","datum_params":[-57,1,-41,0,0,0,0],"no_defs":true},{"EPSG":"4292","projName":"longlat","ellps":"intl","datum_params":[-355,21,72,0,0,0,0],"no_defs":true},{"EPSG":"4293","projName":"longlat","ellps":"bess_nam","datum_params":[616,97,-251,0,0,0,0],"no_defs":true},{"EPSG":"4294","projName":"longlat","ellps":"bessel","datum_params":[-403,684,41,0,0,0,0],"no_defs":true},{"EPSG":"4295","projName":"longlat","ellps":"bessel","no_defs":true},{"EPSG":"4296","projName":"longlat","a":"6378249.2","b":"6356515","no_defs":true},{"EPSG":"4297","projName":"longlat","ellps":"intl","datum_params":[-189,-242,-91,0,0,0,0],"no_defs":true},{"EPSG":"4298","projName":"longlat","ellps":"evrstSS","datum_params":[-679,669,-48,0,0,0,0],"no_defs":true},{"EPSG":"4299","projName":"longlat","datumCode":"ire65","no_defs":true},{"EPSG":"4300","projName":"longlat","ellps":"mod_airy","datum_params":[482.5,-130.6,564.6,-1.042,-0.214,-0.631,8.15],"no_defs":true},{"EPSG":"4301","projName":"longlat","ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"no_defs":true},{"EPSG":"4302","projName":"longlat","a":"6378293.645208759","b":"6356617.987679838","datum_params":[-61.702,284.488,472.052,0,0,0,0],"no_defs":true},{"EPSG":"4303","projName":"longlat","ellps":"helmert","no_defs":true},{"EPSG":"4304","projName":"longlat","a":"6378249.2","b":"6356515","datum_params":[-73,-247,227,0,0,0,0],"no_defs":true},{"EPSG":"4306","projName":"longlat","ellps":"bessel","no_defs":true},{"EPSG":"4307","projName":"longlat","ellps":"clrk80","datum_params":[-209.362,-87.8162,404.62,0.0046,3.4784,0.5805,-1.4547],"no_defs":true},{"EPSG":"4308","projName":"longlat","ellps":"bessel","no_defs":true},{"EPSG":"4309","projName":"longlat","ellps":"intl","datum_params":[-155,171,37,0,0,0,0],"no_defs":true},{"EPSG":"4310","projName":"longlat","a":"6378249.2","b":"6356515","no_defs":true},{"EPSG":"4311","projName":"longlat","ellps":"intl","datum_params":[-265,120,-358,0,0,0,0],"no_defs":true},{"EPSG":"4312","projName":"longlat","datumCode":"hermannskogel","no_defs":true},{"EPSG":"4313","projName":"longlat","ellps":"intl","datum_params":[-106.869,52.2978,-103.724,0.3366,-0.457,1.8422,-1.2747],"no_defs":true},{"EPSG":"4314","projName":"longlat","datumCode":"potsdam","no_defs":true},{"EPSG":"4315","projName":"longlat","a":"6378249.2","b":"6356515","datum_params":[-23,259,-9,0,0,0,0],"no_defs":true},{"EPSG":"4316","projName":"longlat","ellps":"intl","datum_params":[103.25,-100.4,-307.19,0,0,0,0],"no_defs":true},{"EPSG":"4317","projName":"longlat","ellps":"krass","datum_params":[28,-121,-77,0,0,0,0],"no_defs":true},{"EPSG":"4318","projName":"longlat","ellps":"WGS84","datum_params":[-3.2,-5.7,2.8,0,0,0,0],"no_defs":true},{"EPSG":"4319","projName":"longlat","ellps":"GRS80","datum_params":[-20.8,11.3,2.4,0,0,0,0],"no_defs":true},{"EPSG":"4322","projName":"longlat","ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"no_defs":true},{"EPSG":"4324","projName":"longlat","ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"no_defs":true},{"EPSG":"4326","projName":"longlat","datumCode":"WGS84","no_defs":true},{"EPSG":"4463","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4470","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4475","projName":"longlat","ellps":"intl","datum_params":[-381.788,-57.501,-256.673,0,0,0,0],"no_defs":true},{"EPSG":"4483","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4490","projName":"longlat","ellps":"GRS80","no_defs":true},{"EPSG":"4555","projName":"longlat","ellps":"krass","no_defs":true},{"EPSG":"4558","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4600","projName":"longlat","ellps":"clrk80","no_defs":true},{"EPSG":"4601","projName":"longlat","ellps":"clrk80","datum_params":[-255,-15,71,0,0,0,0],"no_defs":true},{"EPSG":"4602","projName":"longlat","ellps":"clrk80","datum_params":[725,685,536,0,0,0,0],"no_defs":true},{"EPSG":"4603","projName":"longlat","ellps":"clrk80","datum_params":[72,213.7,93,0,0,0,0],"no_defs":true},{"EPSG":"4604","projName":"longlat","ellps":"clrk80","datum_params":[174,359,365,0,0,0,0],"no_defs":true},{"EPSG":"4605","projName":"longlat","ellps":"clrk80","datum_params":[9,183,236,0,0,0,0],"no_defs":true},{"EPSG":"4606","projName":"longlat","ellps":"clrk80","datum_params":[-149,128,296,0,0,0,0],"no_defs":true},{"EPSG":"4607","projName":"longlat","ellps":"clrk80","datum_params":[195.671,332.517,274.607,0,0,0,0],"no_defs":true},{"EPSG":"4608","projName":"longlat","ellps":"clrk66","no_defs":true},{"EPSG":"4609","projName":"longlat","ellps":"clrk66","no_defs":true},{"EPSG":"4610","projName":"longlat","a":"6378140","b":"6356755.288157528","no_defs":true},{"EPSG":"4611","projName":"longlat","ellps":"intl","datum_params":[-162.619,-276.959,-161.764,0.067753,-2.24365,-1.15883,-1.09425],"no_defs":true},{"EPSG":"4612","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4613","projName":"longlat","ellps":"bessel","datum_params":[-403,684,41,0,0,0,0],"no_defs":true},{"EPSG":"4614","projName":"longlat","ellps":"intl","datum_params":[-119.425,-303.659,-11.0006,1.1643,0.174458,1.09626,3.65706],"no_defs":true},{"EPSG":"4615","projName":"longlat","ellps":"intl","datum_params":[-499,-249,314,0,0,0,0],"no_defs":true},{"EPSG":"4616","projName":"longlat","ellps":"intl","datum_params":[-289,-124,60,0,0,0,0],"no_defs":true},{"EPSG":"4617","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4618","projName":"longlat","ellps":"aust_SA","datum_params":[-57,1,-41,0,0,0,0],"no_defs":true},{"EPSG":"4619","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4620","projName":"longlat","ellps":"clrk80","datum_params":[-106,-129,165,0,0,0,0],"no_defs":true},{"EPSG":"4621","projName":"longlat","ellps":"intl","datum_params":[137,248,-430,0,0,0,0],"no_defs":true},{"EPSG":"4622","projName":"longlat","ellps":"intl","datum_params":[-467,-16,-300,0,0,0,0],"no_defs":true},{"EPSG":"4623","projName":"longlat","ellps":"intl","datum_params":[-186,230,110,0,0,0,0],"no_defs":true},{"EPSG":"4624","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4625","projName":"longlat","ellps":"intl","datum_params":[186,482,151,0,0,0,0],"no_defs":true},{"EPSG":"4626","projName":"longlat","ellps":"intl","datum_params":[94,-948,-1262,0,0,0,0],"no_defs":true},{"EPSG":"4627","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4628","projName":"longlat","ellps":"intl","datum_params":[162,117,154,0,0,0,0],"no_defs":true},{"EPSG":"4629","projName":"longlat","ellps":"intl","datum_params":[72.438,345.918,79.486,1.6045,0.8823,0.5565,1.3746],"no_defs":true},{"EPSG":"4630","projName":"longlat","ellps":"intl","datum_params":[84,274,65,0,0,0,0],"no_defs":true},{"EPSG":"4631","projName":"longlat","ellps":"intl","datum_params":[145,-187,103,0,0,0,0],"no_defs":true},{"EPSG":"4632","projName":"longlat","ellps":"intl","datum_params":[-382,-59,-262,0,0,0,0],"no_defs":true},{"EPSG":"4633","projName":"longlat","ellps":"intl","datum_params":[335.47,222.58,-230.94,0,0,0,0],"no_defs":true},{"EPSG":"4634","projName":"longlat","ellps":"intl","datum_params":[-13,-348,292,0,0,0,0],"no_defs":true},{"EPSG":"4635","projName":"longlat","ellps":"intl","datum_params":[-122.383,-188.696,103.344,3.5107,-4.9668,-5.7047,4.4798],"no_defs":true},{"EPSG":"4636","projName":"longlat","ellps":"intl","datum_params":[365,194,166,0,0,0,0],"no_defs":true},{"EPSG":"4637","projName":"longlat","ellps":"intl","datum_params":[325,154,172,0,0,0,0],"no_defs":true},{"EPSG":"4638","projName":"longlat","ellps":"clrk66","datum_params":[30,430,368,0,0,0,0],"no_defs":true},{"EPSG":"4639","projName":"longlat","ellps":"intl","datum_params":[253,-132,-127,0,0,0,0],"no_defs":true},{"EPSG":"4640","projName":"longlat","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4641","projName":"longlat","ellps":"intl","datum_params":[287.58,177.78,-135.41,0,0,0,0],"no_defs":true},{"EPSG":"4642","projName":"longlat","ellps":"intl","datum_params":[-13,-348,292,0,0,0,0],"no_defs":true},{"EPSG":"4643","projName":"longlat","ellps":"intl","datum_params":[-480.26,-438.32,-643.429,16.3119,20.1721,-4.0349,-111.7],"no_defs":true},{"EPSG":"4644","projName":"longlat","ellps":"intl","datum_params":[-10.18,-350.43,291.37,0,0,0,0],"no_defs":true},{"EPSG":"4645","projName":"longlat","ellps":"intl","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4646","projName":"longlat","ellps":"intl","datum_params":[-963,510,-359,0,0,0,0],"no_defs":true},{"EPSG":"4657","projName":"longlat","a":"6377019.27","b":"6355762.5391","datum_params":[-28,199,5,0,0,0,0],"no_defs":true},{"EPSG":"4658","projName":"longlat","ellps":"intl","datum_params":[-73,46,-86,0,0,0,0],"no_defs":true},{"EPSG":"4659","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4660","projName":"longlat","ellps":"intl","datum_params":[982.609,552.753,-540.873,6.68163,-31.6115,-19.8482,16.805],"no_defs":true},{"EPSG":"4661","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4662","projName":"longlat","ellps":"intl","datum_params":[-11.64,-348.6,291.98,0,0,0,0],"no_defs":true},{"EPSG":"4663","projName":"longlat","ellps":"intl","datum_params":[-502.862,-247.438,312.724,0,0,0,0],"no_defs":true},{"EPSG":"4664","projName":"longlat","ellps":"intl","datum_params":[-204.619,140.176,55.226,0,0,0,0],"no_defs":true},{"EPSG":"4665","projName":"longlat","ellps":"intl","datum_params":[-106.226,166.366,-37.893,0,0,0,0],"no_defs":true},{"EPSG":"4666","projName":"longlat","ellps":"bessel","datum_params":[508.088,-191.042,565.223,0,0,0,0],"no_defs":true},{"EPSG":"4667","projName":"longlat","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4668","projName":"longlat","ellps":"intl","datum_params":[-86,-98,-119,0,0,0,0],"no_defs":true},{"EPSG":"4669","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4670","projName":"longlat","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4671","projName":"longlat","a":"6378249.2","b":"6356515","no_defs":true},{"EPSG":"4672","projName":"longlat","ellps":"intl","datum_params":[175,-38,113,0,0,0,0],"no_defs":true},{"EPSG":"4673","projName":"longlat","ellps":"intl","datum_params":[174.05,-25.49,112.57,0,0,0.554,0.2263],"no_defs":true},{"EPSG":"4674","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4675","projName":"longlat","ellps":"clrk66","datum_params":[-100,-248,259,0,0,0,0],"no_defs":true},{"EPSG":"4676","projName":"longlat","ellps":"krass","no_defs":true},{"EPSG":"4677","projName":"longlat","ellps":"krass","no_defs":true},{"EPSG":"4678","projName":"longlat","ellps":"krass","datum_params":[44.585,-131.212,-39.544,0,0,0,0],"no_defs":true},{"EPSG":"4679","projName":"longlat","ellps":"clrk80","datum_params":[-80.01,253.26,291.19,0,0,0,0],"no_defs":true},{"EPSG":"4680","projName":"longlat","ellps":"clrk80","datum_params":[124.5,-63.5,-281,0,0,0,0],"no_defs":true},{"EPSG":"4681","projName":"longlat","ellps":"clrk80","no_defs":true},{"EPSG":"4682","projName":"longlat","a":"6377276.345","b":"6356075.41314024","datum_params":[283.7,735.9,261.1,0,0,0,0],"no_defs":true},{"EPSG":"4683","projName":"longlat","ellps":"clrk66","datum_params":[-127.62,-67.24,-47.04,-3.068,4.903,1.578,-1.06],"no_defs":true},{"EPSG":"4684","projName":"longlat","ellps":"intl","datum_params":[-133,-321,50,0,0,0,0],"no_defs":true},{"EPSG":"4685","projName":"longlat","ellps":"intl","no_defs":true},{"EPSG":"4686","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4687","projName":"longlat","ellps":"GRS80","datum_params":[0.072,-0.507,-0.245,-0.0183,0.0003,-0.007,-0.0093],"no_defs":true},{"EPSG":"4688","projName":"longlat","ellps":"intl","datum_params":[347.103,1078.12,2623.92,-33.8875,70.6773,-9.3943,186.074],"no_defs":true},{"EPSG":"4689","projName":"longlat","ellps":"intl","datum_params":[410.721,55.049,80.746,2.5779,2.3514,0.6664,17.3311],"no_defs":true},{"EPSG":"4690","projName":"longlat","ellps":"intl","datum_params":[221.525,152.948,176.768,-2.3847,-1.3896,-0.877,11.4741],"no_defs":true},{"EPSG":"4691","projName":"longlat","ellps":"intl","datum_params":[215.525,149.593,176.229,-3.2624,-1.692,-1.1571,10.4773],"no_defs":true},{"EPSG":"4692","projName":"longlat","ellps":"intl","datum_params":[217.037,86.959,23.956,0,0,0,0],"no_defs":true},{"EPSG":"4693","projName":"longlat","ellps":"WGS84","datum_params":[0,-0.15,0.68,0,0,0,0],"no_defs":true},{"EPSG":"4694","projName":"longlat","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4695","projName":"longlat","ellps":"clrk66","datum_params":[-103.746,-9.614,-255.95,0,0,0,0],"no_defs":true},{"EPSG":"4696","projName":"longlat","ellps":"clrk80","no_defs":true},{"EPSG":"4697","projName":"longlat","ellps":"clrk80","no_defs":true},{"EPSG":"4698","projName":"longlat","ellps":"intl","datum_params":[145,-187,103,0,0,0,0],"no_defs":true},{"EPSG":"4699","projName":"longlat","ellps":"clrk80","datum_params":[-770.1,158.4,-498.2,0,0,0,0],"no_defs":true},{"EPSG":"4700","projName":"longlat","ellps":"clrk80","no_defs":true},{"EPSG":"4701","projName":"longlat","ellps":"clrk80","datum_params":[-79.9,-158,-168.9,0,0,0,0],"no_defs":true},{"EPSG":"4702","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4703","projName":"longlat","ellps":"clrk80","no_defs":true},{"EPSG":"4704","projName":"longlat","ellps":"intl","no_defs":true},{"EPSG":"4705","projName":"longlat","ellps":"intl","no_defs":true},{"EPSG":"4706","projName":"longlat","ellps":"helmert","datum_params":[-146.21,112.63,4.05,0,0,0,0],"no_defs":true},{"EPSG":"4707","projName":"longlat","ellps":"intl","datum_params":[114,-116,-333,0,0,0,0],"no_defs":true},{"EPSG":"4708","projName":"longlat","ellps":"aust_SA","datum_params":[-491,-22,435,0,0,0,0],"no_defs":true},{"EPSG":"4709","projName":"longlat","ellps":"intl","datum_params":[145,75,-272,0,0,0,0],"no_defs":true},{"EPSG":"4710","projName":"longlat","ellps":"intl","datum_params":[-320,550,-494,0,0,0,0],"no_defs":true},{"EPSG":"4711","projName":"longlat","ellps":"intl","datum_params":[124,-234,-25,0,0,0,0],"no_defs":true},{"EPSG":"4712","projName":"longlat","ellps":"intl","datum_params":[-205,107,53,0,0,0,0],"no_defs":true},{"EPSG":"4713","projName":"longlat","ellps":"clrk80","datum_params":[-79,-129,145,0,0,0,0],"no_defs":true},{"EPSG":"4714","projName":"longlat","ellps":"intl","datum_params":[-127,-769,472,0,0,0,0],"no_defs":true},{"EPSG":"4715","projName":"longlat","ellps":"intl","datum_params":[-104,-129,239,0,0,0,0],"no_defs":true},{"EPSG":"4716","projName":"longlat","ellps":"intl","datum_params":[298,-304,-375,0,0,0,0],"no_defs":true},{"EPSG":"4717","projName":"longlat","ellps":"clrk66","datum_params":[-2,151,181,0,0,0,0],"no_defs":true},{"EPSG":"4718","projName":"longlat","ellps":"intl","datum_params":[230,-199,-752,0,0,0,0],"no_defs":true},{"EPSG":"4719","projName":"longlat","ellps":"intl","datum_params":[211,147,111,0,0,0,0],"no_defs":true},{"EPSG":"4720","projName":"longlat","ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"no_defs":true},{"EPSG":"4721","projName":"longlat","ellps":"intl","datum_params":[265.025,384.929,-194.046,0,0,0,0],"no_defs":true},{"EPSG":"4722","projName":"longlat","ellps":"intl","datum_params":[-794,119,-298,0,0,0,0],"no_defs":true},{"EPSG":"4723","projName":"longlat","ellps":"clrk66","datum_params":[67.8,106.1,138.8,0,0,0,0],"no_defs":true},{"EPSG":"4724","projName":"longlat","ellps":"intl","datum_params":[208,-435,-229,0,0,0,0],"no_defs":true},{"EPSG":"4725","projName":"longlat","ellps":"intl","datum_params":[189,-79,-202,0,0,0,0],"no_defs":true},{"EPSG":"4726","projName":"longlat","ellps":"clrk66","datum_params":[42,124,147,0,0,0,0],"no_defs":true},{"EPSG":"4727","projName":"longlat","ellps":"intl","datum_params":[403,-81,277,0,0,0,0],"no_defs":true},{"EPSG":"4728","projName":"longlat","ellps":"intl","datum_params":[-307,-92,127,0,0,0,0],"no_defs":true},{"EPSG":"4729","projName":"longlat","ellps":"intl","datum_params":[185,165,42,0,0,0,0],"no_defs":true},{"EPSG":"4730","projName":"longlat","ellps":"intl","datum_params":[170,42,84,0,0,0,0],"no_defs":true},{"EPSG":"4731","projName":"longlat","ellps":"clrk80","datum_params":[51,391,-36,0,0,0,0],"no_defs":true},{"EPSG":"4732","projName":"longlat","a":"6378270","b":"6356794.343434343","datum_params":[102,52,-38,0,0,0,0],"no_defs":true},{"EPSG":"4733","projName":"longlat","ellps":"intl","datum_params":[276,-57,149,0,0,0,0],"no_defs":true},{"EPSG":"4734","projName":"longlat","ellps":"intl","datum_params":[-632,438,-609,0,0,0,0],"no_defs":true},{"EPSG":"4735","projName":"longlat","ellps":"intl","datum_params":[647,1777,-1124,0,0,0,0],"no_defs":true},{"EPSG":"4736","projName":"longlat","ellps":"clrk80","datum_params":[260,12,-147,0,0,0,0],"no_defs":true},{"EPSG":"4737","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4738","projName":"longlat","a":"6378293.645208759","b":"6356617.987679838","no_defs":true},{"EPSG":"4739","projName":"longlat","ellps":"intl","datum_params":[-156,-271,-189,0,0,0,0],"no_defs":true},{"EPSG":"4740","projName":"longlat","a":"6378136","b":"6356751.361745712","datum_params":[0,0,1.5,0,0,0.076,0],"no_defs":true},{"EPSG":"4741","projName":"longlat","ellps":"intl","no_defs":true},{"EPSG":"4742","projName":"longlat","ellps":"GRS80","no_defs":true},{"EPSG":"4743","projName":"longlat","ellps":"clrk80","datum_params":[70.995,-335.916,262.898,0,0,0,0],"no_defs":true},{"EPSG":"4744","projName":"longlat","ellps":"clrk80","no_defs":true},{"EPSG":"4745","projName":"longlat","ellps":"bessel","no_defs":true},{"EPSG":"4746","projName":"longlat","ellps":"bessel","no_defs":true},{"EPSG":"4747","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4748","projName":"longlat","a":"6378306.3696","b":"6356571.996","datum_params":[51,391,-36,0,0,0,0],"no_defs":true},{"EPSG":"4749","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4750","projName":"longlat","ellps":"WGS84","datum_params":[-56.263,16.136,-22.856,0,0,0,0],"no_defs":true},{"EPSG":"4751","projName":"longlat","a":"6377295.664","b":"6356094.667915204","no_defs":true},{"EPSG":"4752","projName":"longlat","a":"6378306.3696","b":"6356571.996","datum_params":[51,391,-36,0,0,0,0],"no_defs":true},{"EPSG":"4753","projName":"longlat","ellps":"intl","no_defs":true},{"EPSG":"4754","projName":"longlat","ellps":"intl","datum_params":[-208.406,-109.878,-2.5764,0,0,0,0],"no_defs":true},{"EPSG":"4755","projName":"longlat","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4756","projName":"longlat","ellps":"WGS84","datum_params":[-192.873,-39.382,-111.202,-0.00205,-0.0005,0.00335,0.0188],"no_defs":true},{"EPSG":"4757","projName":"longlat","ellps":"WGS84","no_defs":true},{"EPSG":"4758","projName":"longlat","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4759","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4760","projName":"longlat","ellps":"WGS66","no_defs":true},{"EPSG":"4761","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4762","projName":"longlat","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4763","projName":"longlat","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4764","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4765","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"4801","projName":"longlat","ellps":"bessel","datum_params":[674.4,15.1,405.3,0,0,0,0],"from_greenwich":0.12984522414315566,"no_defs":true},{"EPSG":"4802","projName":"longlat","ellps":"intl","datum_params":[307,304,-318,0,0,0,0],"from_greenwich":-1.2929559087288816,"no_defs":true},{"EPSG":"4803","projName":"longlat","ellps":"intl","datum_params":[-304.046,-60.576,103.64,0,0,0,0],"from_greenwich":-0.15938182862187808,"no_defs":true},{"EPSG":"4804","projName":"longlat","ellps":"bessel","datum_params":[-587.8,519.75,145.76,0,0,0,0],"from_greenwich":1.8641463708519166,"no_defs":true},{"EPSG":"4805","projName":"longlat","ellps":"bessel","datum_params":[682,-203,480,0,0,0,0],"from_greenwich":-0.30834150118567066,"no_defs":true},{"EPSG":"4806","projName":"longlat","ellps":"intl","datum_params":[-104.1,-49.1,-9.9,0.971,-2.917,0.714,-11.68],"from_greenwich":0.2173342162225014,"no_defs":true},{"EPSG":"4807","projName":"longlat","a":"6378249.2","b":"6356515","datum_params":[-168,-60,320,0,0,0,0],"from_greenwich":0.04079234433198245,"no_defs":true},{"EPSG":"4808","projName":"longlat","ellps":"bessel","from_greenwich":1.8641463708519166,"no_defs":true},{"EPSG":"4809","projName":"longlat","ellps":"intl","from_greenwich":0.07623554539479932,"no_defs":true},{"EPSG":"4810","projName":"longlat","ellps":"intl","datum_params":[-189,-242,-91,0,0,0,0],"from_greenwich":0.04079234433198245,"no_defs":true},{"EPSG":"4811","projName":"longlat","a":"6378249.2","b":"6356515","datum_params":[-73,-247,227,0,0,0,0],"from_greenwich":0.04079234433198245,"no_defs":true},{"EPSG":"4813","projName":"longlat","ellps":"bessel","datum_params":[-377,681,-50,0,0,0,0],"from_greenwich":1.8641463708519166,"no_defs":true},{"EPSG":"4814","projName":"longlat","ellps":"bessel","from_greenwich":0.315176404461951,"no_defs":true},{"EPSG":"4815","projName":"longlat","ellps":"bessel","from_greenwich":0.4139281758892007,"no_defs":true},{"EPSG":"4816","projName":"longlat","a":"6378249.2","b":"6356515","datum_params":[-263,6,431,0,0,0,0],"from_greenwich":0.04079234433198245,"no_defs":true},{"EPSG":"4817","projName":"longlat","a":"6377492.018","b":"6356173.508712696","datum_params":[278.3,93,474.5,7.889,0.05,-6.61,6.21],"from_greenwich":0.18715020125031445,"no_defs":true},{"EPSG":"4818","projName":"longlat","ellps":"bessel","datum_params":[589,76,480,0,0,0,0],"from_greenwich":-0.30834150118567066,"no_defs":true},{"EPSG":"4819","projName":"longlat","ellps":"clrk80","datum_params":[-209.362,-87.8162,404.62,0.0046,3.4784,0.5805,-1.4547],"from_greenwich":0.04079234433198245,"no_defs":true},{"EPSG":"4820","projName":"longlat","ellps":"bessel","datum_params":[-403,684,41,0,0,0,0],"from_greenwich":1.8641463708519166,"no_defs":true},{"EPSG":"4821","projName":"longlat","a":"6378249.2","b":"6356515","from_greenwich":0.04079234433198245,"no_defs":true},{"EPSG":"4823","projName":"longlat","ellps":"intl","no_defs":true},{"EPSG":"4824","projName":"longlat","ellps":"intl","no_defs":true},{"EPSG":"4901","projName":"longlat","a":"6376523","b":"6355862.933255573","from_greenwich":0.0407919807217158,"no_defs":true},{"EPSG":"4902","projName":"longlat","a":"6376523","b":"6355862.933255573","from_greenwich":0.04079234433198245,"no_defs":true},{"EPSG":"4903","projName":"longlat","a":"6378298.3","b":"6356657.142669561","from_greenwich":-0.06436667622345438,"no_defs":true},{"EPSG":"4904","projName":"longlat","ellps":"bessel","datum_params":[508.088,-191.042,565.223,0,0,0,0],"from_greenwich":-0.15938182862187808,"no_defs":true},{"EPSG":"5013","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"5132","projName":"longlat","ellps":"bessel","no_defs":true},{"EPSG":"5228","projName":"longlat","ellps":"bessel","datum_params":[572.213,85.334,461.94,4.9732,1.529,5.2484,3.5378],"no_defs":true},{"EPSG":"5229","projName":"longlat","ellps":"bessel","datum_params":[572.213,85.334,461.94,4.9732,1.529,5.2484,3.5378],"from_greenwich":-0.30834150118567066,"no_defs":true},{"EPSG":"5233","projName":"longlat","a":"6377276.345","b":"6356075.41314024","datum_params":[-0.293,766.95,87.713,0.195704,1.69507,3.47302,-0.039338],"no_defs":true},{"EPSG":"5246","projName":"longlat","ellps":"GRS80","no_defs":true},{"EPSG":"5252","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"5264","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"5324","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"5340","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"5354","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"5360","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"5365","projName":"longlat","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"5371","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"5373","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"5381","projName":"longlat","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"5393","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"5451","projName":"longlat","ellps":"clrk66","datum_params":[213.11,9.37,-74.95,0,0,0,0],"no_defs":true},{"EPSG":"5464","projName":"longlat","a":"6378293.645208759","b":"6356617.987679838","no_defs":true},{"EPSG":"5467","projName":"longlat","ellps":"clrk66","no_defs":true},{"EPSG":"5489","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"5524","projName":"longlat","ellps":"intl","no_defs":true},{"EPSG":"5527","projName":"longlat","ellps":"aust_SA","no_defs":true},{"EPSG":"5546","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"5561","projName":"longlat","ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"no_defs":true},{"EPSG":"5593","projName":"longlat","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"no_defs":true},{"EPSG":"5681","projName":"longlat","ellps":"bessel","no_defs":true},{"EPSG":"2000","projName":"tmerc","lat0":0,"long0":-1.0821041362364843,"k0":0.9995,"x0":400000,"y0":0,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"2001","projName":"tmerc","lat0":0,"long0":-1.0821041362364843,"k0":0.9995,"x0":400000,"y0":0,"ellps":"clrk80","datum_params":[-255,-15,71,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2002","projName":"tmerc","lat0":0,"long0":-1.0821041362364843,"k0":0.9995,"x0":400000,"y0":0,"ellps":"clrk80","datum_params":[725,685,536,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2003","projName":"tmerc","lat0":0,"long0":-1.0821041362364843,"k0":0.9995,"x0":400000,"y0":0,"ellps":"clrk80","datum_params":[72,213.7,93,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2004","projName":"tmerc","lat0":0,"long0":-1.0821041362364843,"k0":0.9995,"x0":400000,"y0":0,"ellps":"clrk80","datum_params":[174,359,365,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2005","projName":"tmerc","lat0":0,"long0":-1.0821041362364843,"k0":0.9995,"x0":400000,"y0":0,"ellps":"clrk80","datum_params":[9,183,236,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2006","projName":"tmerc","lat0":0,"long0":-1.0821041362364843,"k0":0.9995,"x0":400000,"y0":0,"ellps":"clrk80","datum_params":[-149,128,296,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2007","projName":"tmerc","lat0":0,"long0":-1.0821041362364843,"k0":0.9995,"x0":400000,"y0":0,"ellps":"clrk80","datum_params":[195.671,332.517,274.607,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2008","projName":"tmerc","lat0":0,"long0":-0.9686577348568529,"k0":0.9999,"x0":304800,"y0":0,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2009","projName":"tmerc","lat0":0,"long0":-1.0210176124166828,"k0":0.9999,"x0":304800,"y0":0,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2010","projName":"tmerc","lat0":0,"long0":-1.0733774899765127,"k0":0.9999,"x0":304800,"y0":0,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2011","projName":"tmerc","lat0":0,"long0":-1.1257373675363425,"k0":0.9999,"x0":304800,"y0":0,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2012","projName":"tmerc","lat0":0,"long0":-1.1780972450961724,"k0":0.9999,"x0":304800,"y0":0,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2013","projName":"tmerc","lat0":0,"long0":-1.2304571226560024,"k0":0.9999,"x0":304800,"y0":0,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2014","projName":"tmerc","lat0":0,"long0":-1.2828170002158321,"k0":0.9999,"x0":304800,"y0":0,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2015","projName":"tmerc","lat0":0,"long0":-1.335176877775662,"k0":0.9999,"x0":304800,"y0":0,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2016","projName":"tmerc","lat0":0,"long0":-1.387536755335492,"k0":0.9999,"x0":304800,"y0":0,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2017","projName":"tmerc","lat0":0,"long0":-1.2828170002158321,"k0":0.9999,"x0":304800,"y0":0,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2018","projName":"tmerc","lat0":0,"long0":-1.335176877775662,"k0":0.9999,"x0":304800,"y0":0,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2019","projName":"tmerc","lat0":0,"long0":-1.387536755335492,"k0":0.9999,"x0":304800,"y0":0,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2020","projName":"tmerc","lat0":0,"long0":-1.4398966328953218,"k0":0.9999,"x0":304800,"y0":0,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2021","projName":"tmerc","lat0":0,"long0":-1.413716694115407,"k0":0.9999,"x0":304800,"y0":0,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2022","projName":"tmerc","lat0":0,"long0":-1.4660765716752369,"k0":0.9999,"x0":304800,"y0":0,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2023","projName":"tmerc","lat0":0,"long0":-1.5184364492350666,"k0":0.9999,"x0":304800,"y0":0,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2024","projName":"tmerc","lat0":0,"long0":-1.5707963267948966,"k0":0.9999,"x0":304800,"y0":0,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2025","projName":"tmerc","lat0":0,"long0":-1.6231562043547265,"k0":0.9999,"x0":304800,"y0":0,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2026","projName":"tmerc","lat0":0,"long0":-1.6755160819145565,"k0":0.9999,"x0":304800,"y0":0,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2027","projName":"utm","zone":15,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2028","projName":"utm","zone":16,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2029","projName":"utm","zone":17,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2030","projName":"utm","zone":18,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2031","projName":"utm","zone":17,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2032","projName":"utm","zone":18,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2033","projName":"utm","zone":19,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2034","projName":"utm","zone":20,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2035","projName":"utm","zone":21,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2036","projName":"sterea","lat0":0.8115781021773633,"long0":-1.160643952576229,"k0":0.999912,"x0":2500000,"y0":7500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2037","projName":"utm","zone":19,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2038","projName":"utm","zone":20,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2039","projName":"tmerc","lat0":0.5538696546377418,"long0":0.6144347322546894,"k0":1.0000067,"x0":219529.584,"y0":626907.39,"ellps":"GRS80","datum_params":[-48,55,52,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2040","projName":"utm","zone":30,"ellps":"clrk80","datum_params":[-125,53,467,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2041","projName":"utm","zone":30,"ellps":"clrk80","datum_params":[-124.76,53,466.79,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2042","projName":"utm","zone":29,"ellps":"clrk80","datum_params":[-125,53,467,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2043","projName":"utm","zone":29,"ellps":"clrk80","datum_params":[-124.76,53,466.79,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2044","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":18500000,"y0":0,"ellps":"krass","datum_params":[-17.51,-108.32,-62.39,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2045","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":19500000,"y0":0,"ellps":"krass","datum_params":[-17.51,-108.32,-62.39,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2046","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":0,"y0":0,"axis":"wsu","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2047","projName":"tmerc","lat0":0,"long0":0.29670597283903605,"k0":1,"x0":0,"y0":0,"axis":"wsu","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2048","projName":"tmerc","lat0":0,"long0":0.33161255787892263,"k0":1,"x0":0,"y0":0,"axis":"wsu","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2049","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":0,"y0":0,"axis":"wsu","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2050","projName":"tmerc","lat0":0,"long0":0.4014257279586958,"k0":1,"x0":0,"y0":0,"axis":"wsu","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2051","projName":"tmerc","lat0":0,"long0":0.4363323129985824,"k0":1,"x0":0,"y0":0,"axis":"wsu","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2052","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":0,"y0":0,"axis":"wsu","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2053","projName":"tmerc","lat0":0,"long0":0.5061454830783556,"k0":1,"x0":0,"y0":0,"axis":"wsu","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2054","projName":"tmerc","lat0":0,"long0":0.5410520681182421,"k0":1,"x0":0,"y0":0,"axis":"wsu","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2055","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":0,"y0":0,"axis":"wsu","ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2056","projName":"somerc","lat0":0.8194740686761218,"long0":0.12984522414316146,"k0":1,"x0":2600000,"y0":1200000,"ellps":"bessel","datum_params":[674.374,15.056,405.346,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2057","projName":"omerc","lat0":0.4802941689496028,"longc":0.9181049566601276,"alpha":0.00997737004893907,"k0":0.999895934,"x0":658377.437,"y0":3044969.194,"gamma":"0.5716611944444444","ellps":"intl","datum_params":[-133.63,-157.5,-158.62,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2058","projName":"utm","zone":38,"ellps":"intl","datum_params":[-117,-132,-164,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2059","projName":"utm","zone":39,"ellps":"intl","datum_params":[-117,-132,-164,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2060","projName":"utm","zone":40,"ellps":"intl","datum_params":[-117,-132,-164,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2061","projName":"utm","zone":41,"ellps":"intl","datum_params":[-117,-132,-164,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2062","projName":"lcc","lat1":0.6981317007977318,"lat0":0.6981317007977318,"long0":0,"k0":0.9988085293,"x0":600000,"y0":600000,"a":"6378298.3","b":"6356657.142669561","from_greenwich":-0.06436667622345438,"units":"m","no_defs":true},{"EPSG":"2063","projName":"utm","zone":28,"a":"6378249.2","b":"6356515","datum_params":[-23,259,-9,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2064","projName":"utm","zone":29,"a":"6378249.2","b":"6356515","datum_params":[-23,259,-9,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2065","projName":"krovak","lat0":0.8639379797371931,"long0":0.7417649320975901,"alpha":0.5286277624568585,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[589,76,480,0,0,0,0],"from_greenwich":-0.30834150118567066,"units":"m","no_defs":true},{"EPSG":"2066","projName":"cass","lat0":0.19638756478637148,"long0":-1.059170665005657,"x0":37718.66159325,"y0":36209.91512952,"a":"6378293.645208759","b":"6356617.987679838","to_meter":0.201166195164,"no_defs":true},{"EPSG":"2067","projName":"utm","zone":20,"ellps":"intl","datum_params":[-0.465,372.095,171.736,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2068","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":0.9999,"x0":200000,"y0":0,"ellps":"intl","datum_params":[-115.854,-99.0583,-152.462,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2069","projName":"tmerc","lat0":0,"long0":0.19198621771937624,"k0":0.9999,"x0":200000,"y0":0,"ellps":"intl","datum_params":[-115.854,-99.0583,-152.462,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2070","projName":"tmerc","lat0":0,"long0":0.22689280275926285,"k0":0.9999,"x0":200000,"y0":0,"ellps":"intl","datum_params":[-115.854,-99.0583,-152.462,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2071","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":0.9999,"x0":200000,"y0":0,"ellps":"intl","datum_params":[-115.854,-99.0583,-152.462,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2072","projName":"tmerc","lat0":0,"long0":0.29670597283903605,"k0":0.9999,"x0":200000,"y0":0,"ellps":"intl","datum_params":[-115.854,-99.0583,-152.462,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2073","projName":"tmerc","lat0":0,"long0":0.33161255787892263,"k0":0.9999,"x0":200000,"y0":0,"ellps":"intl","datum_params":[-115.854,-99.0583,-152.462,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2074","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":0.9999,"x0":200000,"y0":0,"ellps":"intl","datum_params":[-115.854,-99.0583,-152.462,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2075","projName":"tmerc","lat0":0,"long0":0.4014257279586958,"k0":0.9999,"x0":200000,"y0":0,"ellps":"intl","datum_params":[-115.854,-99.0583,-152.462,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2076","projName":"tmerc","lat0":0,"long0":0.4363323129985824,"k0":0.9999,"x0":200000,"y0":0,"ellps":"intl","datum_params":[-115.854,-99.0583,-152.462,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2077","projName":"utm","zone":32,"ellps":"intl","datum_params":[-115.854,-99.0583,-152.462,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2078","projName":"utm","zone":33,"ellps":"intl","datum_params":[-115.854,-99.0583,-152.462,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2079","projName":"utm","zone":34,"ellps":"intl","datum_params":[-115.854,-99.0583,-152.462,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2080","projName":"utm","zone":35,"ellps":"intl","datum_params":[-115.854,-99.0583,-152.462,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2081","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.2042771838760873,"k0":1,"x0":2500000,"y0":0,"ellps":"intl","units":"m","no_defs":true},{"EPSG":"2082","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.2042771838760873,"k0":1,"x0":2500000,"y0":0,"ellps":"intl","datum_params":[27.5,14,186.4,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2083","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.2042771838760873,"k0":1,"x0":2500000,"y0":0,"ellps":"intl","datum_params":[16,196,93,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2084","projName":"utm","zone":19,"utmSouth":true,"ellps":"intl","datum_params":[16,196,93,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2085","projName":"lcc","lat1":0.3900810878207327,"lat0":0.3900810878207327,"long0":-1.413716694115407,"k0":0.99993602,"x0":500000,"y0":280296.016,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"2086","projName":"lcc","lat1":0.36157404337149196,"lat0":0.36157404337149196,"long0":-1.3409946419489764,"k0":0.99994848,"x0":500000,"y0":229126.939,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"2087","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":0.9996,"x0":500000,"y0":0,"ellps":"intl","datum_params":[-115.854,-99.0583,-152.462,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2088","projName":"tmerc","lat0":0,"long0":0.19198621771937624,"k0":0.9996,"x0":500000,"y0":0,"datumCode":"carthage","units":"m","no_defs":true},{"EPSG":"2089","projName":"utm","zone":38,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2090","projName":"utm","zone":39,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2091","projName":"tmerc","lat0":0,"long0":0.7853981633974483,"k0":1,"x0":8500000,"y0":0,"ellps":"krass","datum_params":[-76,-138,67,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2092","projName":"tmerc","lat0":0,"long0":0.8901179185171081,"k0":1,"x0":9500000,"y0":0,"ellps":"krass","datum_params":[-76,-138,67,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2093","projName":"tmerc","lat0":0,"long0":1.8500490071139892,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[-17.51,-108.32,-62.39,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2094","projName":"tmerc","lat0":0,"long0":1.8500490071139892,"k0":0.9996,"x0":500000,"y0":0,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"2095","projName":"utm","zone":28,"ellps":"intl","datum_params":[-173,253,27,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2096","projName":"tmerc","lat0":0.6632251157578453,"long0":2.251474735072685,"k0":1,"x0":200000,"y0":500000,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"2097","projName":"tmerc","lat0":0.6632251157578453,"long0":2.2165681500327987,"k0":1,"x0":200000,"y0":500000,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"2098","projName":"tmerc","lat0":0.6632251157578453,"long0":2.181661564992912,"k0":1,"x0":200000,"y0":500000,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"2099","projName":"cass","lat0":0.4430057733190551,"long0":0.8859533689963771,"x0":100000,"y0":100000,"ellps":"helmert","units":"m","no_defs":true},{"EPSG":"2100","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":0.9996,"x0":500000,"y0":0,"datumCode":"GGRS87","units":"m","no_defs":true},{"EPSG":"2101","projName":"lcc","lat1":0.17744180728609021,"lat0":0.17744180728609021,"long0":-1.2497537931468075,"k0":1,"x0":0,"y0":-52684.972,"ellps":"intl","units":"m","no_defs":true},{"EPSG":"2102","projName":"lcc","lat1":0.17744180728609021,"lat0":0.17744180728609021,"long0":-1.2497537931468075,"k0":1,"x0":200000,"y0":147315.028,"ellps":"intl","units":"m","no_defs":true},{"EPSG":"2103","projName":"lcc","lat1":0.17744180728609021,"lat0":0.17744180728609021,"long0":-1.2497537931468075,"k0":1,"x0":500000,"y0":447315.028,"ellps":"intl","units":"m","no_defs":true},{"EPSG":"2104","projName":"lcc","lat1":0.17744180728609021,"lat0":0.17744180728609021,"long0":-1.2497537931468075,"k0":1,"x0":-17044,"y0":-23139.97,"ellps":"intl","units":"m","no_defs":true},{"EPSG":"2105","projName":"tmerc","lat0":-0.6436725799986976,"long0":3.0502101228374574,"k0":0.9999,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2106","projName":"tmerc","lat0":-0.6590557181003033,"long0":3.079914657079038,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2107","projName":"tmerc","lat0":-0.6741237273091876,"long0":3.1046886361837363,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2108","projName":"tmerc","lat0":-0.6920375928261849,"long0":3.0835362152769257,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2109","projName":"tmerc","lat0":-0.6830442990416031,"long0":3.040848370655232,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2110","projName":"tmerc","lat0":-0.6896183725574483,"long0":3.06549629820284,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2111","projName":"tmerc","lat0":-0.7023544279601959,"long0":3.06284436736717,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2112","projName":"tmerc","lat0":-0.7142808445154903,"long0":3.065622349759929,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2113","projName":"tmerc","lat0":-0.7208403736209023,"long0":3.0504234408571453,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2114","projName":"tmerc","lat0":-0.7106059568126802,"long0":3.0136939563762857,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2115","projName":"tmerc","lat0":-0.7203749524870373,"long0":3.0246410492957407,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2116","projName":"tmerc","lat0":-0.7206416000116475,"long0":3.0038667830601966,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2117","projName":"tmerc","lat0":-0.7297318565324513,"long0":2.994655323119115,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2118","projName":"tmerc","lat0":-0.7388608981477439,"long0":2.9941074836594606,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2119","projName":"tmerc","lat0":-0.7450616651291347,"long0":3.0195941388753895,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2120","projName":"tmerc","lat0":-0.7250873414674219,"long0":3.0334161769238213,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2121","projName":"tmerc","lat0":-0.7485038422650127,"long0":2.984159106923093,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2122","projName":"tmerc","lat0":-0.7524114405347555,"long0":2.9716121288559783,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2123","projName":"tmerc","lat0":-0.7675570199326175,"long0":2.9427317778722832,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2124","projName":"tmerc","lat0":-0.7607987172179506,"long0":3.0146538874648847,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2125","projName":"tmerc","lat0":-0.7635573070634637,"long0":2.990805902491104,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2126","projName":"tmerc","lat0":-0.7749601248431601,"long0":2.985511737093389,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2127","projName":"tmerc","lat0":-0.7807730408796633,"long0":2.9577658501234905,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2128","projName":"tmerc","lat0":-0.787715572793152,"long0":2.9391102196743955,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2129","projName":"tmerc","lat0":-0.7952350329871607,"long0":2.9275910466112327,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2130","projName":"tmerc","lat0":-0.7996419893484464,"long0":2.9780262138570572,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2131","projName":"tmerc","lat0":-0.8004322356486551,"long0":2.9719902835272443,"k0":0.99996,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2132","projName":"tmerc","lat0":-0.8133234314293576,"long0":2.9381357441753657,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2133","projName":"utm","zone":58,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2134","projName":"utm","zone":59,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2135","projName":"utm","zone":60,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2136","projName":"tmerc","lat0":0.08144869842640205,"long0":-0.017453292519943295,"k0":0.99975,"x0":274319.7391633579,"y0":0,"a":"6378300","b":"6356751.689189189","datum_params":[-199,32,322,0,0,0,0],"to_meter":0.3047997101815088,"no_defs":true},{"EPSG":"2137","projName":"tmerc","lat0":0,"long0":-0.017453292519943295,"k0":0.9996,"x0":500000,"y0":0,"a":"6378300","b":"6356751.689189189","datum_params":[-199,32,322,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2138","projName":"lcc","lat1":1.0471975511965976,"lat2":0.8028514559173916,"lat0":0.767944870877505,"long0":-1.1955505376161157,"x0":0,"y0":0,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"2139","projName":"tmerc","lat0":0,"long0":-0.9686577348568529,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2140","projName":"tmerc","lat0":0,"long0":-1.0210176124166828,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2141","projName":"tmerc","lat0":0,"long0":-1.0733774899765127,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2142","projName":"tmerc","lat0":0,"long0":-1.1257373675363425,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2143","projName":"tmerc","lat0":0,"long0":-1.1780972450961724,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2144","projName":"tmerc","lat0":0,"long0":-1.2304571226560024,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2145","projName":"tmerc","lat0":0,"long0":-1.2828170002158321,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2146","projName":"tmerc","lat0":0,"long0":-1.335176877775662,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2147","projName":"tmerc","lat0":0,"long0":-1.387536755335492,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2148","projName":"utm","zone":21,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2149","projName":"utm","zone":18,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2150","projName":"utm","zone":17,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2151","projName":"utm","zone":13,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2152","projName":"utm","zone":12,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2153","projName":"utm","zone":11,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2154","projName":"lcc","lat1":0.8552113334772214,"lat2":0.767944870877505,"lat0":0.8115781021773633,"long0":0.05235987755982989,"x0":700000,"y0":6600000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2155","projName":"lcc","lat1":-0.24900030661785771,"lat0":-0.24900030661785771,"long0":2.9670597283903604,"k0":1,"x0":152400.3048006096,"y0":0,"ellps":"clrk66","datum_params":[-115,118,426,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2156","projName":"utm","zone":59,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2157","projName":"tmerc","lat0":0.9337511498169663,"long0":-0.13962634015954636,"k0":0.99982,"x0":600000,"y0":750000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2158","projName":"utm","zone":29,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2159","projName":"tmerc","lat0":0.11635528346628864,"long0":-0.20943951023931956,"k0":1,"x0":152399.8550907544,"y0":0,"a":"6378300","b":"6356751.689189189","to_meter":0.3047997101815088,"no_defs":true},{"EPSG":"2160","projName":"tmerc","lat0":0.11635528346628864,"long0":-0.20943951023931956,"k0":1,"x0":243839.7681452071,"y0":182879.8261089053,"a":"6378300","b":"6356751.689189189","to_meter":0.3047997101815088,"no_defs":true},{"EPSG":"2161","projName":"utm","zone":28,"ellps":"clrk80","datum_params":[-88,4,101,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2162","projName":"utm","zone":29,"ellps":"clrk80","datum_params":[-88,4,101,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2163","projName":"laea","lat0":0.7853981633974483,"long0":-1.7453292519943295,"x0":0,"y0":0,"a":"6370997","b":"6370997","units":"m","no_defs":true},{"EPSG":"2164","projName":"tmerc","lat0":0,"long0":-0.08726646259971647,"k0":0.9996,"x0":500000,"y0":0,"ellps":"clrk80","datum_params":[-125,53,467,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2165","projName":"tmerc","lat0":0,"long0":-0.08726646259971647,"k0":0.9996,"x0":500000,"y0":0,"ellps":"clrk80","datum_params":[-124.76,53,466.79,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2166","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":1,"x0":3500000,"y0":0,"ellps":"krass","datum_params":[26,-121,-78,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2167","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":1,"x0":4500000,"y0":0,"ellps":"krass","datum_params":[26,-121,-78,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2168","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":5500000,"y0":0,"ellps":"krass","datum_params":[26,-121,-78,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2169","projName":"tmerc","lat0":0.8697557439105077,"long0":0.10762863720631699,"k0":1,"x0":80000,"y0":100000,"ellps":"intl","datum_params":[-189.681,18.3463,-42.7695,-0.33746,-3.09264,2.53861,0.4598],"units":"m","no_defs":true},{"EPSG":"2170","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":0.9999,"x0":500000,"y0":0,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"2171","projName":"sterea","lat0":0.8835729338221293,"long0":0.36797358396213775,"k0":0.9998,"x0":4637000,"y0":5647000,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"2172","projName":"sterea","lat0":0.9250584405146723,"long0":0.37529427054689185,"k0":0.9998,"x0":4603000,"y0":5806000,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"2173","projName":"sterea","lat0":0.9352055908602951,"long0":0.2968514169433688,"k0":0.9998,"x0":3501000,"y0":5999000,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"2174","projName":"sterea","lat0":0.9018261689159033,"long0":0.29098517140194347,"k0":0.9998,"x0":3703000,"y0":5627000,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"2175","projName":"tmerc","lat0":0,"long0":0.3308853373572582,"k0":0.999983,"x0":237000,"y0":-4700000,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"2176","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":0.999923,"x0":5500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2177","projName":"tmerc","lat0":0,"long0":0.3141592653589793,"k0":0.999923,"x0":6500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2178","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":0.999923,"x0":7500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2179","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":0.999923,"x0":8500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2180","projName":"tmerc","lat0":0,"long0":0.33161255787892263,"k0":0.9993,"x0":500000,"y0":-5300000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2188","projName":"utm","zone":25,"ellps":"intl","datum_params":[-425,-169,81,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2189","projName":"utm","zone":26,"ellps":"intl","datum_params":[-104,167,-38,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2190","projName":"utm","zone":26,"ellps":"intl","datum_params":[-203,141,53,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2191","projName":"utm","zone":28,"ellps":"intl","units":"m","no_defs":true},{"EPSG":"2192","projName":"lcc","lat1":0.8168140899333461,"lat0":0.8168140899333461,"long0":0.04079234433197664,"k0":0.99987742,"x0":600000,"y0":2200000,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2193","projName":"tmerc","lat0":0,"long0":3.01941960595019,"k0":0.9996,"x0":1600000,"y0":10000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2194","projName":"lcc","lat1":-0.24900030661785771,"lat0":-0.24900030661785771,"long0":-2.9670597283903604,"k0":1,"x0":152400.3048006096,"y0":0,"ellps":"clrk66","datum_params":[-115,118,426,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2195","projName":"utm","zone":2,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2196","projName":"tmerc","lat0":0,"long0":0.16580627893946132,"k0":0.99995,"x0":200000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2197","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":0.99995,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2198","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":900000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2199","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":4500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"2200","projName":"sterea","lat0":0.8115781021773633,"long0":-1.160643952576229,"k0":0.999912,"x0":300000,"y0":800000,"a":"6378135","b":"6356750.304921594","units":"m","no_defs":true},{"EPSG":"2201","projName":"utm","zone":18,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2202","projName":"utm","zone":19,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2203","projName":"utm","zone":20,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2204","projName":"lcc","lat1":0.6152285613280012,"lat2":0.6355907359346015,"lat0":0.6050474740247007,"long0":-1.5009831567151235,"x0":609601.2192024384,"y0":30480.06096012192,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"2205","projName":"lcc","lat1":0.6626433393405138,"lat2":0.6800966318604571,"lat0":0.6544984694978736,"long0":-1.4704398948052226,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"2206","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":9500000,"y0":0,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2207","projName":"tmerc","lat0":0,"long0":0.5235987755982988,"k0":1,"x0":10500000,"y0":0,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2208","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":11500000,"y0":0,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2209","projName":"tmerc","lat0":0,"long0":0.6283185307179586,"k0":1,"x0":12500000,"y0":0,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2210","projName":"tmerc","lat0":0,"long0":0.6806784082777885,"k0":1,"x0":13500000,"y0":0,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2211","projName":"tmerc","lat0":0,"long0":0.7330382858376184,"k0":1,"x0":14500000,"y0":0,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2212","projName":"tmerc","lat0":0,"long0":0.7853981633974483,"k0":1,"x0":15500000,"y0":0,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2213","projName":"tmerc","lat0":0,"long0":0.5235987755982988,"k0":0.9996,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2214","projName":"tmerc","lat0":0,"long0":0.1832595714594046,"k0":0.999,"x0":1000000,"y0":1000000,"ellps":"intl","datum_params":[-206.1,-174.7,-87.7,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2215","projName":"utm","zone":32,"a":"6378249.2","b":"6356515","datum_params":[-70.9,-151.8,-41.4,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2216","projName":"utm","zone":22,"ellps":"intl","datum_params":[164,138,-189,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2217","projName":"utm","zone":23,"ellps":"intl","datum_params":[164,138,-189,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2219","projName":"utm","zone":19,"a":"6378135","b":"6356750.304921594","units":"m","no_defs":true},{"EPSG":"2220","projName":"utm","zone":20,"a":"6378135","b":"6356750.304921594","units":"m","no_defs":true},{"EPSG":"2222","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.9227710592804204,"k0":0.9999,"x0":213360,"y0":0,"datumCode":"NAD83","units":"ft","no_defs":true},{"EPSG":"2223","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.953314321190321,"k0":0.9999,"x0":213360,"y0":0,"datumCode":"NAD83","units":"ft","no_defs":true},{"EPSG":"2224","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.9853120241435498,"k0":0.999933333,"x0":213360,"y0":0,"datumCode":"NAD83","units":"ft","no_defs":true},{"EPSG":"2225","projName":"lcc","lat1":0.7272205216643038,"lat2":0.6981317007977318,"lat0":0.6864961724511032,"long0":-2.129301687433082,"x0":2000000.0001016,"y0":500000.0001016001,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2226","projName":"lcc","lat1":0.6952228187110747,"lat2":0.6690428799311599,"lat0":0.6574073515845307,"long0":-2.129301687433082,"x0":2000000.0001016,"y0":500000.0001016001,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2227","projName":"lcc","lat1":0.670788209183154,"lat2":0.6469353760725649,"lat0":0.6370451769779303,"long0":-2.1031217486531673,"x0":2000000.0001016,"y0":500000.0001016001,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2228","projName":"lcc","lat1":0.6501351463678877,"lat2":0.6283185307179586,"lat0":0.6166830023713299,"long0":-2.076941809873252,"x0":2000000.0001016,"y0":500000.0001016001,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2229","projName":"lcc","lat1":0.6190101080406556,"lat2":0.5939937220954035,"lat0":0.5846852994181004,"long0":-2.059488517353309,"x0":2000000.0001016,"y0":500000.0001016001,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2230","projName":"lcc","lat1":0.591375728217412,"lat2":0.5721771064454744,"lat0":0.5614142427248425,"long0":-2.028945255443408,"x0":2000000.0001016,"y0":500000.0001016001,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2231","projName":"lcc","lat1":0.7118034466050207,"lat2":0.6931866012504145,"lat0":0.6864961724511032,"long0":-1.8413223608540177,"x0":914401.8288036576,"y0":304800.6096012192,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2232","projName":"lcc","lat1":0.693768377667746,"lat2":0.6710790973918198,"lat0":0.6603162336711882,"long0":-1.8413223608540177,"x0":914401.8288036576,"y0":304800.6096012192,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2233","projName":"lcc","lat1":0.670788209183154,"lat2":0.649844258159222,"lat0":0.6399540590645874,"long0":-1.8413223608540177,"x0":914401.8288036576,"y0":304800.6096012192,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2234","projName":"lcc","lat1":0.7307111801682926,"lat2":0.7190756518216638,"lat0":0.712676111231018,"long0":-1.2697270308258748,"x0":304800.6096012192,"y0":152400.3048006096,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2235","projName":"tmerc","lat0":0.6632251157578453,"long0":-1.3162691442123904,"k0":0.999995,"x0":200000.0001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2236","projName":"tmerc","lat0":0.42469678465195343,"long0":-1.413716694115407,"k0":0.999941177,"x0":200000.0001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2237","projName":"tmerc","lat0":0.42469678465195343,"long0":-1.4311699866353502,"k0":0.999941177,"x0":200000.0001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2238","projName":"lcc","lat1":0.5366887449882564,"lat2":0.5163265703816557,"lat0":0.5061454830783556,"long0":-1.4748032179352084,"x0":600000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2239","projName":"tmerc","lat0":0.5235987755982988,"long0":-1.4340788687220076,"k0":0.9999,"x0":200000.0001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2240","projName":"tmerc","lat0":0.5235987755982988,"long0":-1.468985453761894,"k0":0.9999,"x0":699999.9998983998,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2241","projName":"tmerc","lat0":0.7272205216643038,"long0":-1.957677644320307,"k0":0.999947368,"x0":200000.0001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2242","projName":"tmerc","lat0":0.7272205216643038,"long0":-1.9896753472735358,"k0":0.999947368,"x0":500000.0001016001,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2243","projName":"tmerc","lat0":0.7272205216643038,"long0":-2.0202186091834364,"k0":0.999933333,"x0":800000.0001016001,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2244","projName":"tmerc","lat0":0.6544984694978736,"long0":-1.4951653925418091,"k0":0.999966667,"x0":99999.99989839978,"y0":249364.9987299975,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2245","projName":"tmerc","lat0":0.6544984694978736,"long0":-1.5198908902783952,"k0":0.999966667,"x0":900000,"y0":249364.9987299975,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2246","projName":"lcc","lat1":0.6626433393405138,"lat2":0.6800966318604571,"lat0":0.6544984694978736,"long0":-1.4704398948052226,"x0":500000.0001016001,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2247","projName":"lcc","lat1":0.6620615629231823,"lat2":0.6411176118992503,"lat0":0.6341362948912732,"long0":-1.4966198335851375,"x0":500000.0001016001,"y0":500000.0001016001,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2248","projName":"lcc","lat1":0.688532389911763,"lat2":0.6684611035138281,"lat0":0.6574073515845307,"long0":-1.3439035240356338,"x0":399999.9998983998,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2249","projName":"lcc","lat1":0.7449647023929129,"lat2":0.7280931862903012,"lat0":0.7155849933176751,"long0":-1.2479104151759457,"x0":200000.0001016002,"y0":750000,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2250","projName":"lcc","lat1":0.7240207513689809,"lat2":0.7205300928649924,"lat0":0.7155849933176751,"long0":-1.2304571226560024,"x0":500000.0001016001,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2251","projName":"lcc","lat1":0.8217591894806636,"lat2":0.7938339214487541,"lat0":0.7816166166847939,"long0":-1.5184364492350666,"x0":7999999.999968001,"y0":0,"datumCode":"NAD83","units":"ft","no_defs":true},{"EPSG":"2252","projName":"lcc","lat1":0.7976154681614086,"lat2":0.7711446411728279,"lat0":0.7560184543222105,"long0":-1.4724761122658825,"x0":5999999.999976001,"y0":0,"datumCode":"NAD83","units":"ft","no_defs":true},{"EPSG":"2253","projName":"lcc","lat1":0.7621271067041904,"lat2":0.7347836150896128,"lat0":0.7243116395776468,"long0":-1.4724761122658825,"x0":3999999.999984,"y0":0,"datumCode":"NAD83","units":"ft","no_defs":true},{"EPSG":"2254","projName":"tmerc","lat0":0.5148721293383273,"long0":-1.550434152188296,"k0":0.99995,"x0":300000.0000000001,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2255","projName":"tmerc","lat0":0.5148721293383273,"long0":-1.576614090968211,"k0":0.99995,"x0":699999.9998983998,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2256","projName":"lcc","lat1":0.8552113334772214,"lat2":0.7853981633974483,"lat0":0.7723081940074908,"long0":-1.911135530933791,"x0":599999.9999976,"y0":0,"datumCode":"NAD83","units":"ft","no_defs":true},{"EPSG":"2257","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.8209601862474165,"k0":0.999909091,"x0":165000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2258","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.8544123302439752,"k0":0.9999,"x0":500000.0001016001,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2259","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.882046710067218,"k0":0.999916667,"x0":830000.0001016001,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2260","projName":"tmerc","lat0":0.6777695261911315,"long0":-1.3002702927357754,"k0":0.9999,"x0":150000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2261","projName":"tmerc","lat0":0.6981317007977318,"long0":-1.3366313188189907,"k0":0.9999375,"x0":249999.9998983998,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2262","projName":"tmerc","lat0":0.6981317007977318,"long0":-1.3715379038588773,"k0":0.9999375,"x0":350000.0001016001,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2263","projName":"lcc","lat1":0.7161667697350065,"lat2":0.7097672291443605,"lat0":0.7010405828843889,"long0":-1.2915436464758039,"x0":300000.0000000001,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2264","projName":"lcc","lat1":0.6312274128046157,"lat2":0.5992297098513867,"lat0":0.5890486225480862,"long0":-1.3788101090755203,"x0":609601.2192024384,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2265","projName":"lcc","lat1":0.8505571221385698,"lat2":0.8278678418626436,"lat0":0.8203047484373349,"long0":-1.7540558982543013,"x0":599999.9999976,"y0":0,"datumCode":"NAD83","units":"ft","no_defs":true},{"EPSG":"2266","projName":"lcc","lat1":0.8287405064886407,"lat2":0.8060512262127145,"lat0":0.797033691744077,"long0":-1.7540558982543013,"x0":599999.9999976,"y0":0,"datumCode":"NAD83","units":"ft","no_defs":true},{"EPSG":"2267","projName":"lcc","lat1":0.6416993883165819,"lat2":0.6207554372926499,"lat0":0.6108652381980153,"long0":-1.710422666954443,"x0":600000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2268","projName":"lcc","lat1":0.6149376731193353,"lat2":0.5922483928434091,"lat0":0.5817764173314434,"long0":-1.710422666954443,"x0":600000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2269","projName":"lcc","lat1":0.8028514559173916,"lat2":0.7737626350508195,"lat0":0.7621271067041904,"long0":-2.1031217486531673,"x0":2500000.0001424,"y0":0,"datumCode":"NAD83","units":"ft","no_defs":true},{"EPSG":"2270","projName":"lcc","lat1":0.767944870877505,"lat2":0.738856050010933,"lat0":0.7272205216643038,"long0":-2.1031217486531673,"x0":1500000.0001464,"y0":0,"datumCode":"NAD83","units":"ft","no_defs":true},{"EPSG":"2271","projName":"lcc","lat1":0.7321656212116213,"lat2":0.713548775857015,"lat0":0.7010405828843889,"long0":-1.3569934934255912,"x0":600000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2272","projName":"lcc","lat1":0.7150032169003437,"lat2":0.6969681479630688,"lat0":0.6864961724511032,"long0":-1.3569934934255912,"x0":600000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2273","projName":"lcc","lat1":0.6079563561113583,"lat2":0.5672320068981571,"lat0":0.5555964785515282,"long0":-1.413716694115407,"x0":609600,"y0":0,"datumCode":"NAD83","units":"ft","no_defs":true},{"EPSG":"2274","projName":"lcc","lat1":0.6355907359346015,"lat2":0.6152285613280012,"lat0":0.5992297098513867,"long0":-1.5009831567151235,"x0":600000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2275","projName":"lcc","lat1":0.6315183010132815,"lat2":0.6047565858160352,"lat0":0.5934119456780721,"long0":-1.7715091907742444,"x0":200000.0001016002,"y0":999999.9998983998,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2276","projName":"lcc","lat1":0.5928301692607406,"lat2":0.5608324663075113,"lat0":0.5526875964648711,"long0":-1.7191493132144147,"x0":600000,"y0":2000000.0001016,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2277","projName":"lcc","lat1":0.5564691431775254,"lat2":0.525634993058959,"lat0":0.5177810114249846,"long0":-1.7511470161676435,"x0":699999.9998983998,"y0":3000000,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2278","projName":"lcc","lat1":0.5285438751456161,"lat2":0.4953826193577238,"lat0":0.485783308471755,"long0":-1.7278759594743862,"x0":600000,"y0":3999999.9998984,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2279","projName":"lcc","lat1":0.485783308471755,"lat2":0.456694487605183,"lat0":0.44796784134521134,"long0":-1.7191493132144147,"x0":300000.0000000001,"y0":5000000.0001016,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2280","projName":"lcc","lat1":0.729256739124964,"lat2":0.7106398937703579,"lat0":0.7039494649710464,"long0":-1.9460421159736774,"x0":500000.0001504,"y0":999999.9999960001,"datumCode":"NAD83","units":"ft","no_defs":true},{"EPSG":"2281","projName":"lcc","lat1":0.7094763409356949,"lat2":0.6809692964864543,"lat0":0.6690428799311599,"long0":-1.9460421159736774,"x0":500000.0001504,"y0":1999999.999992,"datumCode":"NAD83","units":"ft","no_defs":true},{"EPSG":"2282","projName":"lcc","lat1":0.6693337681398254,"lat2":0.6495533699505563,"lat0":0.6399540590645874,"long0":-1.9460421159736774,"x0":500000.0001504,"y0":2999999.999988,"datumCode":"NAD83","units":"ft","no_defs":true},{"EPSG":"2283","projName":"lcc","lat1":0.6841690667817772,"lat2":0.6638068921751766,"lat0":0.6574073515845307,"long0":-1.3700834628155487,"x0":3500000.0001016,"y0":2000000.0001016,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2284","projName":"lcc","lat1":0.6626433393405138,"lat2":0.6416993883165819,"lat0":0.6341362948912732,"long0":-1.3700834628155487,"x0":3500000.0001016,"y0":999999.9998983998,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2285","projName":"lcc","lat1":0.8505571221385698,"lat2":0.8290313946973066,"lat0":0.8203047484373349,"long0":-2.108939512826481,"x0":500000.0001016001,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2286","projName":"lcc","lat1":0.8261225126106495,"lat2":0.7999425738307345,"lat0":0.7912159275707629,"long0":-2.1031217486531673,"x0":500000.0001016001,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2287","projName":"lcc","lat1":0.8162323135160149,"lat2":0.7952883624920829,"lat0":0.7883070454841054,"long0":-1.5707963267948966,"x0":600000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2288","projName":"lcc","lat1":0.7941248096574199,"lat2":0.7723081940074908,"lat0":0.765035988790848,"long0":-1.5707963267948966,"x0":600000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2289","projName":"lcc","lat1":0.7691084237121679,"lat2":0.74583736701891,"lat0":0.7330382858376184,"long0":-1.5707963267948966,"x0":600000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2290","projName":"sterea","lat0":0.8246680715673207,"long0":-1.0995574287564276,"k0":0.999912,"x0":700000,"y0":400000,"a":"6378135","b":"6356750.304921594","units":"m","no_defs":true},{"EPSG":"2291","projName":"sterea","lat0":0.8246680715673207,"long0":-1.0995574287564276,"k0":0.999912,"x0":400000,"y0":800000,"a":"6378135","b":"6356750.304921594","units":"m","no_defs":true},{"EPSG":"2292","projName":"sterea","lat0":0.8246680715673207,"long0":-1.0995574287564276,"k0":0.999912,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2294","projName":"tmerc","lat0":0,"long0":-1.0733774899765127,"k0":0.9999,"x0":4500000,"y0":0,"a":"6378135","b":"6356750.304921594","units":"m","no_defs":true},{"EPSG":"2295","projName":"tmerc","lat0":0,"long0":-1.1257373675363425,"k0":0.9999,"x0":5500000,"y0":0,"a":"6378135","b":"6356750.304921594","units":"m","no_defs":true},{"EPSG":"2308","projName":"tmerc","lat0":0,"long0":1.9024088846738192,"k0":0.9996,"x0":500000,"y0":10000000,"ellps":"bessel","datum_params":[-377,681,-50,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2309","projName":"tmerc","lat0":0,"long0":2.0245819323134224,"k0":0.9996,"x0":500000,"y0":10000000,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"2310","projName":"tmerc","lat0":0,"long0":2.303834612632515,"k0":0.9996,"x0":500000,"y0":10000000,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"2311","projName":"tmerc","lat0":0,"long0":0.10471975511965978,"k0":0.9996,"x0":500000,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"2312","projName":"utm","zone":33,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"2313","projName":"utm","zone":33,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"2314","projName":"cass","lat0":0.18224146272907463,"long0":-1.0704686078898555,"x0":86501.46392052001,"y0":65379.0134283,"a":"6378293.645208759","b":"6356617.987679838","datum_params":[-61.702,284.488,472.052,0,0,0,0],"to_meter":0.3047972654,"no_defs":true},{"EPSG":"2315","projName":"utm","zone":19,"utmSouth":true,"ellps":"intl","datum_params":[-148,136,90,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2316","projName":"utm","zone":20,"utmSouth":true,"ellps":"intl","datum_params":[-148,136,90,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2317","projName":"lcc","lat1":0.15707963267948966,"lat2":0.05235987755982989,"lat0":0.10471975511965978,"long0":-1.1519173063162575,"x0":1000000,"y0":1000000,"ellps":"intl","datum_params":[-288,175,-376,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2318","projName":"lcc","lat1":0.29670597283903605,"lat2":0.5759586531581288,"lat0":0.4378945572120425,"long0":0.8377580409572782,"x0":0,"y0":0,"ellps":"intl","datum_params":[-143,-236,7,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2319","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":500000,"y0":0,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2320","projName":"tmerc","lat0":0,"long0":0.5235987755982988,"k0":1,"x0":500000,"y0":0,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2321","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":500000,"y0":0,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2322","projName":"tmerc","lat0":0,"long0":0.6283185307179586,"k0":1,"x0":500000,"y0":0,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2323","projName":"tmerc","lat0":0,"long0":0.6806784082777885,"k0":1,"x0":500000,"y0":0,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2324","projName":"tmerc","lat0":0,"long0":0.7330382858376184,"k0":1,"x0":500000,"y0":0,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2325","projName":"tmerc","lat0":0,"long0":0.7853981633974483,"k0":1,"x0":500000,"y0":0,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2326","projName":"tmerc","lat0":0.38942018981064425,"long0":1.9927917296157087,"k0":1,"x0":836694.05,"y0":819069.8,"ellps":"intl","datum_params":[-162.619,-276.959,-161.764,0.067753,-2.24365,-1.15883,-1.09425],"units":"m","no_defs":true},{"EPSG":"2327","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":13500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2328","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":14500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2329","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":15500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2330","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":16500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2331","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":17500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2332","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":18500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2333","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":19500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2334","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":20500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2335","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":21500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2336","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":22500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2337","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":23500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2338","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2339","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2340","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2341","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2342","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2343","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2344","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2345","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2346","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2347","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2348","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2349","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":25500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2350","projName":"tmerc","lat0":0,"long0":1.361356816555577,"k0":1,"x0":26500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2351","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":27500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2352","projName":"tmerc","lat0":0,"long0":1.4660765716752369,"k0":1,"x0":28500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2353","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":29500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2354","projName":"tmerc","lat0":0,"long0":1.5707963267948966,"k0":1,"x0":30500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2355","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":31500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2356","projName":"tmerc","lat0":0,"long0":1.6755160819145565,"k0":1,"x0":32500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2357","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":33500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2358","projName":"tmerc","lat0":0,"long0":1.7802358370342162,"k0":1,"x0":34500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2359","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":35500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2360","projName":"tmerc","lat0":0,"long0":1.8849555921538759,"k0":1,"x0":36500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2361","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":37500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2362","projName":"tmerc","lat0":0,"long0":1.9896753472735358,"k0":1,"x0":38500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2363","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":39500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2364","projName":"tmerc","lat0":0,"long0":2.0943951023931953,"k0":1,"x0":40500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2365","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":41500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2366","projName":"tmerc","lat0":0,"long0":2.199114857512855,"k0":1,"x0":42500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2367","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":43500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2368","projName":"tmerc","lat0":0,"long0":2.303834612632515,"k0":1,"x0":44500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2369","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":45500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2370","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2371","projName":"tmerc","lat0":0,"long0":1.361356816555577,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2372","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2373","projName":"tmerc","lat0":0,"long0":1.4660765716752369,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2374","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2375","projName":"tmerc","lat0":0,"long0":1.5707963267948966,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2376","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2377","projName":"tmerc","lat0":0,"long0":1.6755160819145565,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2378","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2379","projName":"tmerc","lat0":0,"long0":1.7802358370342162,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2380","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2381","projName":"tmerc","lat0":0,"long0":1.8849555921538759,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2382","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2383","projName":"tmerc","lat0":0,"long0":1.9896753472735358,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2384","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2385","projName":"tmerc","lat0":0,"long0":2.0943951023931953,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2386","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2387","projName":"tmerc","lat0":0,"long0":2.199114857512855,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2388","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2389","projName":"tmerc","lat0":0,"long0":2.303834612632515,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2390","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":500000,"y0":0,"a":"6378140","b":"6356755.288157528","units":"m","no_defs":true},{"EPSG":"2391","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":1500000,"y0":0,"ellps":"intl","datum_params":[-96.062,-82.428,-121.753,4.801,0.345,-1.376,1.496],"units":"m","no_defs":true},{"EPSG":"2392","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":1,"x0":2500000,"y0":0,"ellps":"intl","datum_params":[-96.062,-82.428,-121.753,4.801,0.345,-1.376,1.496],"units":"m","no_defs":true},{"EPSG":"2393","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":3500000,"y0":0,"ellps":"intl","datum_params":[-96.062,-82.428,-121.753,4.801,0.345,-1.376,1.496],"units":"m","no_defs":true},{"EPSG":"2394","projName":"tmerc","lat0":0,"long0":0.5235987755982988,"k0":1,"x0":4500000,"y0":0,"ellps":"intl","datum_params":[-96.062,-82.428,-121.753,4.801,0.345,-1.376,1.496],"units":"m","no_defs":true},{"EPSG":"2395","projName":"tmerc","lat0":0,"long0":0.7853981633974483,"k0":1,"x0":8500000,"y0":0,"ellps":"krass","datum_params":[-76,-138,67,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2396","projName":"tmerc","lat0":0,"long0":0.8901179185171081,"k0":1,"x0":9500000,"y0":0,"ellps":"krass","datum_params":[-76,-138,67,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2397","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":1,"x0":3500000,"y0":0,"ellps":"krass","datum_params":[26,-121,-78,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2398","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":1,"x0":4500000,"y0":0,"ellps":"krass","datum_params":[26,-121,-78,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2399","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":5500000,"y0":0,"ellps":"krass","datum_params":[26,-121,-78,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2400","projName":"tmerc","lat0":0,"long0":0.27590649629207475,"k0":1,"x0":1500000,"y0":0,"ellps":"bessel","datum_params":[414.1,41.3,603.1,-0.855,2.141,-7.023,0],"units":"m","no_defs":true},{"EPSG":"2401","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":25500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2402","projName":"tmerc","lat0":0,"long0":1.361356816555577,"k0":1,"x0":26500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2403","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":27500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2404","projName":"tmerc","lat0":0,"long0":1.4660765716752369,"k0":1,"x0":28500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2405","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":29500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2406","projName":"tmerc","lat0":0,"long0":1.5707963267948966,"k0":1,"x0":30500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2407","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":31500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2408","projName":"tmerc","lat0":0,"long0":1.6755160819145565,"k0":1,"x0":32500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2409","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":33500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2410","projName":"tmerc","lat0":0,"long0":1.7802358370342162,"k0":1,"x0":34500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2411","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":35500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2412","projName":"tmerc","lat0":0,"long0":1.8849555921538759,"k0":1,"x0":36500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2413","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":37500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2414","projName":"tmerc","lat0":0,"long0":1.9896753472735358,"k0":1,"x0":38500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2415","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":39500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2416","projName":"tmerc","lat0":0,"long0":2.0943951023931953,"k0":1,"x0":40500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2417","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":41500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2418","projName":"tmerc","lat0":0,"long0":2.199114857512855,"k0":1,"x0":42500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2419","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":43500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2420","projName":"tmerc","lat0":0,"long0":2.303834612632515,"k0":1,"x0":44500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2421","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":45500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2422","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2423","projName":"tmerc","lat0":0,"long0":1.361356816555577,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2424","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2425","projName":"tmerc","lat0":0,"long0":1.4660765716752369,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2426","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2427","projName":"tmerc","lat0":0,"long0":1.5707963267948966,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2428","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2429","projName":"tmerc","lat0":0,"long0":1.6755160819145565,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2430","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2431","projName":"tmerc","lat0":0,"long0":1.7802358370342162,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2432","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2433","projName":"tmerc","lat0":0,"long0":1.8849555921538759,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2434","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2435","projName":"tmerc","lat0":0,"long0":1.9896753472735358,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2436","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2437","projName":"tmerc","lat0":0,"long0":2.0943951023931953,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2438","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2439","projName":"tmerc","lat0":0,"long0":2.199114857512855,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2440","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2441","projName":"tmerc","lat0":0,"long0":2.303834612632515,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2442","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2443","projName":"tmerc","lat0":0.5759586531581288,"long0":2.260201381332657,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2444","projName":"tmerc","lat0":0.5759586531581288,"long0":2.2863813201125716,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2445","projName":"tmerc","lat0":0.6283185307179586,"long0":2.306743494719173,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2446","projName":"tmerc","lat0":0.5759586531581288,"long0":2.3300145514124297,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2447","projName":"tmerc","lat0":0.6283185307179586,"long0":2.344558961845715,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2448","projName":"tmerc","lat0":0.6283185307179586,"long0":2.3736477827122884,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2449","projName":"tmerc","lat0":0.6283185307179586,"long0":2.3940099573188895,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2450","projName":"tmerc","lat0":0.6283185307179586,"long0":2.4172810140121466,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2451","projName":"tmerc","lat0":0.6283185307179586,"long0":2.440552070705403,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2452","projName":"tmerc","lat0":0.6981317007977318,"long0":2.4580053632253467,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2453","projName":"tmerc","lat0":0.767944870877505,"long0":2.447824275922047,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2454","projName":"tmerc","lat0":0.767944870877505,"long0":2.482730860961934,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2455","projName":"tmerc","lat0":0.767944870877505,"long0":2.5176374460018205,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2456","projName":"tmerc","lat0":0.4537856055185257,"long0":2.478367537831948,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2457","projName":"tmerc","lat0":0.4537856055185257,"long0":2.2252947962927703,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2458","projName":"tmerc","lat0":0.4537856055185257,"long0":2.1642082724729685,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2459","projName":"tmerc","lat0":0.4537856055185257,"long0":2.2863813201125716,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2460","projName":"tmerc","lat0":0.3490658503988659,"long0":2.3736477827122884,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2461","projName":"tmerc","lat0":0.4537856055185257,"long0":2.6878070480712677,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2462","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":4500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"2463","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2464","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2465","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2466","projName":"tmerc","lat0":0,"long0":0.6806784082777885,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2467","projName":"tmerc","lat0":0,"long0":0.7853981633974483,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2468","projName":"tmerc","lat0":0,"long0":0.8901179185171081,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2469","projName":"tmerc","lat0":0,"long0":0.9948376736367679,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2470","projName":"tmerc","lat0":0,"long0":1.0995574287564276,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2471","projName":"tmerc","lat0":0,"long0":1.2042771838760873,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2472","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2473","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2474","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2475","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2476","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2477","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2478","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2479","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2480","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2481","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2482","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2483","projName":"tmerc","lat0":0,"long0":2.4609142453120048,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2484","projName":"tmerc","lat0":0,"long0":2.5656340004316642,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2485","projName":"tmerc","lat0":0,"long0":2.670353755551324,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2486","projName":"tmerc","lat0":0,"long0":2.775073510670984,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2487","projName":"tmerc","lat0":0,"long0":2.8797932657906435,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2488","projName":"tmerc","lat0":0,"long0":2.9845130209103035,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2489","projName":"tmerc","lat0":0,"long0":3.0892327760299634,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2490","projName":"tmerc","lat0":0,"long0":-3.0892327760299634,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2491","projName":"tmerc","lat0":0,"long0":-2.9845130209103035,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2492","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2493","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2494","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2495","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2496","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2497","projName":"tmerc","lat0":0,"long0":0.6806784082777885,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2498","projName":"tmerc","lat0":0,"long0":0.7853981633974483,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2499","projName":"tmerc","lat0":0,"long0":0.8901179185171081,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2500","projName":"tmerc","lat0":0,"long0":0.9948376736367679,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2501","projName":"tmerc","lat0":0,"long0":1.0995574287564276,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2502","projName":"tmerc","lat0":0,"long0":1.2042771838760873,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2503","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2504","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2505","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2506","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2507","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2508","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2509","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2510","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2511","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2512","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2513","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2514","projName":"tmerc","lat0":0,"long0":2.4609142453120048,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2515","projName":"tmerc","lat0":0,"long0":2.5656340004316642,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2516","projName":"tmerc","lat0":0,"long0":2.670353755551324,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2517","projName":"tmerc","lat0":0,"long0":2.775073510670984,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2518","projName":"tmerc","lat0":0,"long0":2.8797932657906435,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2519","projName":"tmerc","lat0":0,"long0":2.9845130209103035,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2520","projName":"tmerc","lat0":0,"long0":3.0892327760299634,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2521","projName":"tmerc","lat0":0,"long0":-3.0892327760299634,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2522","projName":"tmerc","lat0":0,"long0":-2.9845130209103035,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2523","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":7500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2524","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":1,"x0":8500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2525","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":9500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2526","projName":"tmerc","lat0":0,"long0":0.5235987755982988,"k0":1,"x0":10500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2527","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":11500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2528","projName":"tmerc","lat0":0,"long0":0.6283185307179586,"k0":1,"x0":12500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2529","projName":"tmerc","lat0":0,"long0":0.6806784082777885,"k0":1,"x0":13500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2530","projName":"tmerc","lat0":0,"long0":0.7330382858376184,"k0":1,"x0":14500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2531","projName":"tmerc","lat0":0,"long0":0.7853981633974483,"k0":1,"x0":15500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2532","projName":"tmerc","lat0":0,"long0":0.8377580409572782,"k0":1,"x0":16500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2533","projName":"tmerc","lat0":0,"long0":0.8901179185171081,"k0":1,"x0":17500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2534","projName":"tmerc","lat0":0,"long0":0.9424777960769379,"k0":1,"x0":18500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2535","projName":"tmerc","lat0":0,"long0":0.9948376736367679,"k0":1,"x0":19500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2536","projName":"tmerc","lat0":0,"long0":1.0471975511965976,"k0":1,"x0":20500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2537","projName":"tmerc","lat0":0,"long0":1.0995574287564276,"k0":1,"x0":21500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2538","projName":"tmerc","lat0":0,"long0":1.1519173063162575,"k0":1,"x0":22500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2539","projName":"tmerc","lat0":0,"long0":1.2042771838760873,"k0":1,"x0":23500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2540","projName":"tmerc","lat0":0,"long0":1.2566370614359172,"k0":1,"x0":24500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2541","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":25500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2542","projName":"tmerc","lat0":0,"long0":1.361356816555577,"k0":1,"x0":26500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2543","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":27500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2544","projName":"tmerc","lat0":0,"long0":1.4660765716752369,"k0":1,"x0":28500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2545","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":29500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2546","projName":"tmerc","lat0":0,"long0":1.5707963267948966,"k0":1,"x0":30500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2547","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":31500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2548","projName":"tmerc","lat0":0,"long0":1.6755160819145565,"k0":1,"x0":32500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2549","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":33500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2550","projName":"utm","zone":50,"utmSouth":true,"ellps":"bessel","datum_params":[-404.78,685.68,45.47,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2551","projName":"tmerc","lat0":0,"long0":1.7802358370342162,"k0":1,"x0":34500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2552","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":35500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2553","projName":"tmerc","lat0":0,"long0":1.8849555921538759,"k0":1,"x0":36500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2554","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":37500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2555","projName":"tmerc","lat0":0,"long0":1.9896753472735358,"k0":1,"x0":38500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2556","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":39500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2557","projName":"tmerc","lat0":0,"long0":2.0943951023931953,"k0":1,"x0":40500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2558","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":41500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2559","projName":"tmerc","lat0":0,"long0":2.199114857512855,"k0":1,"x0":42500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2560","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":43500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2561","projName":"tmerc","lat0":0,"long0":2.303834612632515,"k0":1,"x0":44500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2562","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":45500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2563","projName":"tmerc","lat0":0,"long0":2.4085543677521746,"k0":1,"x0":46500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2564","projName":"tmerc","lat0":0,"long0":2.4609142453120048,"k0":1,"x0":47500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2565","projName":"tmerc","lat0":0,"long0":2.5132741228718345,"k0":1,"x0":48500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2566","projName":"tmerc","lat0":0,"long0":2.5656340004316642,"k0":1,"x0":49500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2567","projName":"tmerc","lat0":0,"long0":2.6179938779914944,"k0":1,"x0":50500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2568","projName":"tmerc","lat0":0,"long0":2.670353755551324,"k0":1,"x0":51500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2569","projName":"tmerc","lat0":0,"long0":2.722713633111154,"k0":1,"x0":52500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2570","projName":"tmerc","lat0":0,"long0":2.775073510670984,"k0":1,"x0":53500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2571","projName":"tmerc","lat0":0,"long0":2.827433388230814,"k0":1,"x0":54500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2572","projName":"tmerc","lat0":0,"long0":2.8797932657906435,"k0":1,"x0":55500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2573","projName":"tmerc","lat0":0,"long0":2.9321531433504737,"k0":1,"x0":56500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2574","projName":"tmerc","lat0":0,"long0":2.9845130209103035,"k0":1,"x0":57500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2575","projName":"tmerc","lat0":0,"long0":3.036872898470133,"k0":1,"x0":58500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2576","projName":"tmerc","lat0":0,"long0":3.0892327760299634,"k0":1,"x0":59500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2577","projName":"tmerc","lat0":0,"long0":3.141592653589793,"k0":1,"x0":60000000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2578","projName":"tmerc","lat0":0,"long0":-3.0892327760299634,"k0":1,"x0":61500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2579","projName":"tmerc","lat0":0,"long0":-3.036872898470133,"k0":1,"x0":62500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2580","projName":"tmerc","lat0":0,"long0":-2.9845130209103035,"k0":1,"x0":63500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2581","projName":"tmerc","lat0":0,"long0":-2.9321531433504737,"k0":1,"x0":64500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2582","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2583","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2584","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2585","projName":"tmerc","lat0":0,"long0":0.5235987755982988,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2586","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2587","projName":"tmerc","lat0":0,"long0":0.6283185307179586,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2588","projName":"tmerc","lat0":0,"long0":0.6806784082777885,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2589","projName":"tmerc","lat0":0,"long0":0.7330382858376184,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2590","projName":"tmerc","lat0":0,"long0":0.7853981633974483,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2591","projName":"tmerc","lat0":0,"long0":0.8377580409572782,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2592","projName":"tmerc","lat0":0,"long0":0.8901179185171081,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2593","projName":"tmerc","lat0":0,"long0":0.9424777960769379,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2594","projName":"tmerc","lat0":0,"long0":0.9948376736367679,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2595","projName":"tmerc","lat0":0,"long0":1.0471975511965976,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2596","projName":"tmerc","lat0":0,"long0":1.0995574287564276,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2597","projName":"tmerc","lat0":0,"long0":1.1519173063162575,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2598","projName":"tmerc","lat0":0,"long0":1.2042771838760873,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2599","projName":"tmerc","lat0":0,"long0":1.2566370614359172,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2600","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":0.9998,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2601","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2602","projName":"tmerc","lat0":0,"long0":1.361356816555577,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2603","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2604","projName":"tmerc","lat0":0,"long0":1.4660765716752369,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2605","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2606","projName":"tmerc","lat0":0,"long0":1.5707963267948966,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2607","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2608","projName":"tmerc","lat0":0,"long0":1.6755160819145565,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2609","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2610","projName":"tmerc","lat0":0,"long0":1.7802358370342162,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2611","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2612","projName":"tmerc","lat0":0,"long0":1.8849555921538759,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2613","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2614","projName":"tmerc","lat0":0,"long0":1.9896753472735358,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2615","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2616","projName":"tmerc","lat0":0,"long0":2.0943951023931953,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2617","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2618","projName":"tmerc","lat0":0,"long0":2.199114857512855,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2619","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2620","projName":"tmerc","lat0":0,"long0":2.303834612632515,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2621","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2622","projName":"tmerc","lat0":0,"long0":2.4085543677521746,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2623","projName":"tmerc","lat0":0,"long0":2.4609142453120048,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2624","projName":"tmerc","lat0":0,"long0":2.5132741228718345,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2625","projName":"tmerc","lat0":0,"long0":2.5656340004316642,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2626","projName":"tmerc","lat0":0,"long0":2.6179938779914944,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2627","projName":"tmerc","lat0":0,"long0":2.670353755551324,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2628","projName":"tmerc","lat0":0,"long0":2.722713633111154,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2629","projName":"tmerc","lat0":0,"long0":2.775073510670984,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2630","projName":"tmerc","lat0":0,"long0":2.827433388230814,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2631","projName":"tmerc","lat0":0,"long0":2.8797932657906435,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2632","projName":"tmerc","lat0":0,"long0":2.9321531433504737,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2633","projName":"tmerc","lat0":0,"long0":2.9845130209103035,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2634","projName":"tmerc","lat0":0,"long0":3.036872898470133,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2635","projName":"tmerc","lat0":0,"long0":3.0892327760299634,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2636","projName":"tmerc","lat0":0,"long0":3.141592653589793,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2637","projName":"tmerc","lat0":0,"long0":-3.0892327760299634,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2638","projName":"tmerc","lat0":0,"long0":-3.036872898470133,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2639","projName":"tmerc","lat0":0,"long0":-2.9845130209103035,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2640","projName":"tmerc","lat0":0,"long0":-2.9321531433504737,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2641","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":7500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2642","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":1,"x0":8500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2643","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":9500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2644","projName":"tmerc","lat0":0,"long0":0.5235987755982988,"k0":1,"x0":10500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2645","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":11500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2646","projName":"tmerc","lat0":0,"long0":0.6283185307179586,"k0":1,"x0":12500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2647","projName":"tmerc","lat0":0,"long0":0.6806784082777885,"k0":1,"x0":13500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2648","projName":"tmerc","lat0":0,"long0":0.7330382858376184,"k0":1,"x0":14500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2649","projName":"tmerc","lat0":0,"long0":0.7853981633974483,"k0":1,"x0":15500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2650","projName":"tmerc","lat0":0,"long0":0.8377580409572782,"k0":1,"x0":16500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2651","projName":"tmerc","lat0":0,"long0":0.8901179185171081,"k0":1,"x0":17500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2652","projName":"tmerc","lat0":0,"long0":0.9424777960769379,"k0":1,"x0":18500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2653","projName":"tmerc","lat0":0,"long0":0.9948376736367679,"k0":1,"x0":19500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2654","projName":"tmerc","lat0":0,"long0":1.0471975511965976,"k0":1,"x0":20500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2655","projName":"tmerc","lat0":0,"long0":1.0995574287564276,"k0":1,"x0":21500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2656","projName":"tmerc","lat0":0,"long0":1.1519173063162575,"k0":1,"x0":22500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2657","projName":"tmerc","lat0":0,"long0":1.2042771838760873,"k0":1,"x0":23500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2658","projName":"tmerc","lat0":0,"long0":1.2566370614359172,"k0":1,"x0":24500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2659","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":25500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2660","projName":"tmerc","lat0":0,"long0":1.361356816555577,"k0":1,"x0":26500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2661","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":27500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2662","projName":"tmerc","lat0":0,"long0":1.4660765716752369,"k0":1,"x0":28500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2663","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":29500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2664","projName":"tmerc","lat0":0,"long0":1.5707963267948966,"k0":1,"x0":30500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2665","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":31500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2666","projName":"tmerc","lat0":0,"long0":1.6755160819145565,"k0":1,"x0":32500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2667","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":33500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2668","projName":"tmerc","lat0":0,"long0":1.7802358370342162,"k0":1,"x0":34500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2669","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":35500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2670","projName":"tmerc","lat0":0,"long0":1.8849555921538759,"k0":1,"x0":36500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2671","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":37500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2672","projName":"tmerc","lat0":0,"long0":1.9896753472735358,"k0":1,"x0":38500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2673","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":39500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2674","projName":"tmerc","lat0":0,"long0":2.0943951023931953,"k0":1,"x0":40500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2675","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":41500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2676","projName":"tmerc","lat0":0,"long0":2.199114857512855,"k0":1,"x0":42500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2677","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":43500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2678","projName":"tmerc","lat0":0,"long0":2.303834612632515,"k0":1,"x0":44500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2679","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":45500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2680","projName":"tmerc","lat0":0,"long0":2.4085543677521746,"k0":1,"x0":46500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2681","projName":"tmerc","lat0":0,"long0":2.4609142453120048,"k0":1,"x0":47500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2682","projName":"tmerc","lat0":0,"long0":2.5132741228718345,"k0":1,"x0":48500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2683","projName":"tmerc","lat0":0,"long0":2.5656340004316642,"k0":1,"x0":49500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2684","projName":"tmerc","lat0":0,"long0":2.6179938779914944,"k0":1,"x0":50500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2685","projName":"tmerc","lat0":0,"long0":2.670353755551324,"k0":1,"x0":51500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2686","projName":"tmerc","lat0":0,"long0":2.722713633111154,"k0":1,"x0":52500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2687","projName":"tmerc","lat0":0,"long0":2.775073510670984,"k0":1,"x0":53500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2688","projName":"tmerc","lat0":0,"long0":2.827433388230814,"k0":1,"x0":54500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2689","projName":"tmerc","lat0":0,"long0":2.8797932657906435,"k0":1,"x0":55500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2690","projName":"tmerc","lat0":0,"long0":2.9321531433504737,"k0":1,"x0":56500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2691","projName":"tmerc","lat0":0,"long0":2.9845130209103035,"k0":1,"x0":57500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2692","projName":"tmerc","lat0":0,"long0":3.036872898470133,"k0":1,"x0":58500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2693","projName":"tmerc","lat0":0,"long0":3.0892327760299634,"k0":1,"x0":59500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2694","projName":"tmerc","lat0":0,"long0":3.141592653589793,"k0":1,"x0":60000000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2695","projName":"tmerc","lat0":0,"long0":-3.0892327760299634,"k0":1,"x0":61500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2696","projName":"tmerc","lat0":0,"long0":-3.036872898470133,"k0":1,"x0":62500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2697","projName":"tmerc","lat0":0,"long0":-2.9845130209103035,"k0":1,"x0":63500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2698","projName":"tmerc","lat0":0,"long0":-2.9321531433504737,"k0":1,"x0":64500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2699","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2700","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2701","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2702","projName":"tmerc","lat0":0,"long0":0.5235987755982988,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2703","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2704","projName":"tmerc","lat0":0,"long0":0.6283185307179586,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2705","projName":"tmerc","lat0":0,"long0":0.6806784082777885,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2706","projName":"tmerc","lat0":0,"long0":0.7330382858376184,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2707","projName":"tmerc","lat0":0,"long0":0.7853981633974483,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2708","projName":"tmerc","lat0":0,"long0":0.8377580409572782,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2709","projName":"tmerc","lat0":0,"long0":0.8901179185171081,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2710","projName":"tmerc","lat0":0,"long0":0.9424777960769379,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2711","projName":"tmerc","lat0":0,"long0":0.9948376736367679,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2712","projName":"tmerc","lat0":0,"long0":1.0471975511965976,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2713","projName":"tmerc","lat0":0,"long0":1.0995574287564276,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2714","projName":"tmerc","lat0":0,"long0":1.1519173063162575,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2715","projName":"tmerc","lat0":0,"long0":1.2042771838760873,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2716","projName":"tmerc","lat0":0,"long0":1.2566370614359172,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2717","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2718","projName":"tmerc","lat0":0,"long0":1.361356816555577,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2719","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2720","projName":"tmerc","lat0":0,"long0":1.4660765716752369,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2721","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2722","projName":"tmerc","lat0":0,"long0":1.5707963267948966,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2723","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2724","projName":"tmerc","lat0":0,"long0":1.6755160819145565,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2725","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2726","projName":"tmerc","lat0":0,"long0":1.7802358370342162,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2727","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2728","projName":"tmerc","lat0":0,"long0":1.8849555921538759,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2729","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2730","projName":"tmerc","lat0":0,"long0":1.9896753472735358,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2731","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2732","projName":"tmerc","lat0":0,"long0":2.0943951023931953,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2733","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2734","projName":"tmerc","lat0":0,"long0":2.199114857512855,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2735","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2736","projName":"utm","zone":36,"utmSouth":true,"ellps":"clrk66","datum_params":[-73.472,-51.66,-112.482,0.953,4.6,-2.368,0.586],"units":"m","no_defs":true},{"EPSG":"2737","projName":"utm","zone":37,"utmSouth":true,"ellps":"clrk66","datum_params":[-73.472,-51.66,-112.482,0.953,4.6,-2.368,0.586],"units":"m","no_defs":true},{"EPSG":"2738","projName":"tmerc","lat0":0,"long0":2.303834612632515,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2739","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2740","projName":"tmerc","lat0":0,"long0":2.4085543677521746,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2741","projName":"tmerc","lat0":0,"long0":2.4609142453120048,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2742","projName":"tmerc","lat0":0,"long0":2.5132741228718345,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2743","projName":"tmerc","lat0":0,"long0":2.5656340004316642,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2744","projName":"tmerc","lat0":0,"long0":2.6179938779914944,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2745","projName":"tmerc","lat0":0,"long0":2.670353755551324,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2746","projName":"tmerc","lat0":0,"long0":2.722713633111154,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2747","projName":"tmerc","lat0":0,"long0":2.775073510670984,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2748","projName":"tmerc","lat0":0,"long0":2.827433388230814,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2749","projName":"tmerc","lat0":0,"long0":2.8797932657906435,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2750","projName":"tmerc","lat0":0,"long0":2.9321531433504737,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2751","projName":"tmerc","lat0":0,"long0":2.9845130209103035,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2752","projName":"tmerc","lat0":0,"long0":3.036872898470133,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2753","projName":"tmerc","lat0":0,"long0":3.0892327760299634,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2754","projName":"tmerc","lat0":0,"long0":3.141592653589793,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2755","projName":"tmerc","lat0":0,"long0":-3.0892327760299634,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2756","projName":"tmerc","lat0":0,"long0":-3.036872898470133,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2757","projName":"tmerc","lat0":0,"long0":-2.9845130209103035,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2758","projName":"tmerc","lat0":0,"long0":-2.9321531433504737,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"2759","projName":"tmerc","lat0":0.5323254218582705,"long0":-1.498074274628466,"k0":0.99996,"x0":200000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2760","projName":"tmerc","lat0":0.5235987755982988,"long0":-1.5271630954950384,"k0":0.999933333,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2761","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.9227710592804204,"k0":0.9999,"x0":213360,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2762","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.953314321190321,"k0":0.9999,"x0":213360,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2763","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.9853120241435498,"k0":0.999933333,"x0":213360,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2764","projName":"lcc","lat1":0.6323909656392787,"lat2":0.6097016853633525,"lat0":0.5992297098513867,"long0":-1.6057029118347832,"x0":400000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2765","projName":"lcc","lat1":0.6067928032766954,"lat2":0.5811946409141117,"lat0":0.5701408889848142,"long0":-1.6057029118347832,"x0":400000,"y0":400000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2766","projName":"lcc","lat1":0.7272205216643038,"lat2":0.6981317007977318,"lat0":0.6864961724511032,"long0":-2.129301687433082,"x0":2000000,"y0":500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2767","projName":"lcc","lat1":0.6952228187110747,"lat2":0.6690428799311599,"lat0":0.6574073515845307,"long0":-2.129301687433082,"x0":2000000,"y0":500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2768","projName":"lcc","lat1":0.670788209183154,"lat2":0.6469353760725649,"lat0":0.6370451769779303,"long0":-2.1031217486531673,"x0":2000000,"y0":500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2769","projName":"lcc","lat1":0.6501351463678877,"lat2":0.6283185307179586,"lat0":0.6166830023713299,"long0":-2.076941809873252,"x0":2000000,"y0":500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2770","projName":"lcc","lat1":0.6190101080406556,"lat2":0.5939937220954035,"lat0":0.5846852994181004,"long0":-2.059488517353309,"x0":2000000,"y0":500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2771","projName":"lcc","lat1":0.591375728217412,"lat2":0.5721771064454744,"lat0":0.5614142427248425,"long0":-2.028945255443408,"x0":2000000,"y0":500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2772","projName":"lcc","lat1":0.7118034466050207,"lat2":0.6931866012504145,"lat0":0.6864961724511032,"long0":-1.8413223608540177,"x0":914401.8289,"y0":304800.6096,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2773","projName":"lcc","lat1":0.693768377667746,"lat2":0.6710790973918198,"lat0":0.6603162336711882,"long0":-1.8413223608540177,"x0":914401.8289,"y0":304800.6096,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2774","projName":"lcc","lat1":0.670788209183154,"lat2":0.649844258159222,"lat0":0.6399540590645874,"long0":-1.8413223608540177,"x0":914401.8289,"y0":304800.6096,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2775","projName":"lcc","lat1":0.7307111801682926,"lat2":0.7190756518216638,"lat0":0.712676111231018,"long0":-1.2697270308258748,"x0":304800.6096,"y0":152400.3048,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2776","projName":"tmerc","lat0":0.6632251157578453,"long0":-1.3162691442123904,"k0":0.999995,"x0":200000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2777","projName":"tmerc","lat0":0.42469678465195343,"long0":-1.413716694115407,"k0":0.999941177,"x0":200000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2778","projName":"tmerc","lat0":0.42469678465195343,"long0":-1.4311699866353502,"k0":0.999941177,"x0":200000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2779","projName":"lcc","lat1":0.5366887449882564,"lat2":0.5163265703816557,"lat0":0.5061454830783556,"long0":-1.4748032179352084,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2780","projName":"tmerc","lat0":0.5235987755982988,"long0":-1.4340788687220076,"k0":0.9999,"x0":200000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2781","projName":"tmerc","lat0":0.5235987755982988,"long0":-1.468985453761894,"k0":0.9999,"x0":700000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2782","projName":"tmerc","lat0":0.32870367579226534,"long0":-2.7139869868511823,"k0":0.999966667,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2783","projName":"tmerc","lat0":0.35488361457218026,"long0":-2.734349161457784,"k0":0.999966667,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2784","projName":"tmerc","lat0":0.3694280250054665,"long0":-2.7576202181510405,"k0":0.99999,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2785","projName":"tmerc","lat0":0.3810635533520952,"long0":-2.7838001569309556,"k0":0.99999,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2786","projName":"tmerc","lat0":0.37815467126543817,"long0":-2.7954356852775852,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2787","projName":"tmerc","lat0":0.7272205216643038,"long0":-1.957677644320307,"k0":0.999947368,"x0":200000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2788","projName":"tmerc","lat0":0.7272205216643038,"long0":-1.9896753472735358,"k0":0.999947368,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2789","projName":"tmerc","lat0":0.7272205216643038,"long0":-2.0202186091834364,"k0":0.999933333,"x0":800000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2790","projName":"tmerc","lat0":0.6399540590645874,"long0":-1.5417075059283243,"k0":0.999975,"x0":300000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2791","projName":"tmerc","lat0":0.6399540590645874,"long0":-1.573705208881554,"k0":0.999941177,"x0":700000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2792","projName":"tmerc","lat0":0.6544984694978736,"long0":-1.4951653925418091,"k0":0.999966667,"x0":100000,"y0":250000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2793","projName":"tmerc","lat0":0.6544984694978736,"long0":-1.5198908902783952,"k0":0.999966667,"x0":900000,"y0":250000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2794","projName":"lcc","lat1":0.7551457896962134,"lat2":0.7342018386722814,"lat0":0.7243116395776468,"long0":-1.631882850614698,"x0":1500000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2795","projName":"lcc","lat1":0.729256739124964,"lat2":0.7088945645183635,"lat0":0.6981317007977318,"long0":-1.631882850614698,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2796","projName":"lcc","lat1":0.6943501540850774,"lat2":0.6757333087304713,"lat0":0.6690428799311599,"long0":-1.710422666954443,"x0":400000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2797","projName":"lcc","lat1":0.6731153148524798,"lat2":0.6504260345765536,"lat0":0.6399540590645874,"long0":-1.7191493132144147,"x0":400000,"y0":400000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2798","projName":"lcc","lat1":0.6626433393405138,"lat2":0.6800966318604571,"lat0":0.6544984694978736,"long0":-1.4704398948052226,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2799","projName":"lcc","lat1":0.6620615629231823,"lat2":0.6411176118992503,"lat0":0.6341362948912732,"long0":-1.4966198335851375,"x0":500000,"y0":500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2800","projName":"lcc","lat1":0.5701408889848142,"lat2":0.5439609502048994,"lat0":0.5323254218582705,"long0":-1.6144295580947547,"x0":1000000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2801","projName":"lcc","lat1":0.5358160803622591,"lat2":0.5113814708343386,"lat0":0.49741883681838395,"long0":-1.5940673834881542,"x0":1000000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2802","projName":"tmerc","lat0":0.7621271067041904,"long0":-1.1955505376161157,"k0":0.9999,"x0":300000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2803","projName":"tmerc","lat0":0.7475826962709047,"long0":-1.224639358482688,"k0":0.999966667,"x0":900000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2804","projName":"lcc","lat1":0.688532389911763,"lat2":0.6684611035138281,"lat0":0.6574073515845307,"long0":-1.3439035240356338,"x0":400000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2805","projName":"lcc","lat1":0.7449647023929129,"lat2":0.7280931862903012,"lat0":0.7155849933176751,"long0":-1.2479104151759457,"x0":200000,"y0":750000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2806","projName":"lcc","lat1":0.7240207513689809,"lat2":0.7205300928649924,"lat0":0.7155849933176751,"long0":-1.2304571226560024,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2807","projName":"lcc","lat1":0.8217591894806636,"lat2":0.7938339214487541,"lat0":0.7816166166847939,"long0":-1.5184364492350666,"x0":8000000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2808","projName":"lcc","lat1":0.7976154681614086,"lat2":0.7711446411728279,"lat0":0.7560184543222105,"long0":-1.4724761122658825,"x0":6000000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2809","projName":"lcc","lat1":0.7621271067041904,"lat2":0.7347836150896128,"lat0":0.7243116395776468,"long0":-1.4724761122658825,"x0":4000000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2810","projName":"lcc","lat1":0.8488117928865756,"lat2":0.8208865248546663,"lat0":0.8115781021773633,"long0":-1.6249015336067207,"x0":800000,"y0":100000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2811","projName":"lcc","lat1":0.821177413063332,"lat2":0.79616102711808,"lat0":0.7853981633974483,"long0":-1.6449728200046556,"x0":800000,"y0":100000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2812","projName":"lcc","lat1":0.7891797101101027,"lat2":0.7641633241648506,"lat0":0.7504915783575618,"long0":-1.6406094968746698,"x0":800000,"y0":100000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2813","projName":"tmerc","lat0":0.5148721293383273,"long0":-1.550434152188296,"k0":0.99995,"x0":300000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2814","projName":"tmerc","lat0":0.5148721293383273,"long0":-1.576614090968211,"k0":0.99995,"x0":700000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2815","projName":"tmerc","lat0":0.6254096486313016,"long0":-1.5795229730548683,"k0":0.999933333,"x0":250000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2816","projName":"tmerc","lat0":0.6254096486313016,"long0":-1.6144295580947547,"k0":0.999933333,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2817","projName":"tmerc","lat0":0.6312274128046157,"long0":-1.6493361431346414,"k0":0.999941177,"x0":850000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2818","projName":"lcc","lat1":0.8552113334772214,"lat2":0.7853981633974483,"lat0":0.7723081940074908,"long0":-1.911135530933791,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2819","projName":"lcc","lat1":0.7504915783575618,"lat2":0.6981317007977318,"lat0":0.6952228187110747,"long0":-1.7453292519943295,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2820","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.017309727096779,"k0":0.9999,"x0":200000,"y0":8000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2821","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.0362174606600516,"k0":0.9999,"x0":500000,"y0":6000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2822","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.0696696046566085,"k0":0.9999,"x0":800000,"y0":4000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2823","projName":"tmerc","lat0":0.7417649320975901,"long0":-1.2508192972626029,"k0":0.999966667,"x0":300000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2824","projName":"tmerc","lat0":0.6777695261911315,"long0":-1.3002702927357754,"k0":0.9999,"x0":150000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2825","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.8209601862474165,"k0":0.999909091,"x0":165000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2826","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.8544123302439752,"k0":0.9999,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2827","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.882046710067218,"k0":0.999916667,"x0":830000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2828","projName":"tmerc","lat0":0.6777695261911315,"long0":-1.3002702927357754,"k0":0.9999,"x0":150000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2829","projName":"tmerc","lat0":0.6981317007977318,"long0":-1.3366313188189907,"k0":0.9999375,"x0":250000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2830","projName":"tmerc","lat0":0.6981317007977318,"long0":-1.3715379038588773,"k0":0.9999375,"x0":350000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2831","projName":"lcc","lat1":0.7161667697350065,"lat2":0.7097672291443605,"lat0":0.7010405828843889,"long0":-1.2915436464758039,"x0":300000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2832","projName":"lcc","lat1":0.8505571221385698,"lat2":0.8278678418626436,"lat0":0.8203047484373349,"long0":-1.7540558982543013,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2833","projName":"lcc","lat1":0.8287405064886407,"lat2":0.8060512262127145,"lat0":0.797033691744077,"long0":-1.7540558982543013,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2834","projName":"lcc","lat1":0.7278022980816354,"lat2":0.7056947942230405,"lat0":0.6923139366244172,"long0":-1.4398966328953218,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2835","projName":"lcc","lat1":0.6987134772150633,"lat2":0.6760241969391368,"lat0":0.6632251157578453,"long0":-1.4398966328953218,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2836","projName":"lcc","lat1":0.6416993883165819,"lat2":0.6207554372926499,"lat0":0.6108652381980153,"long0":-1.710422666954443,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2837","projName":"lcc","lat1":0.6149376731193353,"lat2":0.5922483928434091,"lat0":0.5817764173314434,"long0":-1.710422666954443,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2838","projName":"lcc","lat1":0.8028514559173916,"lat2":0.7737626350508195,"lat0":0.7621271067041904,"long0":-2.1031217486531673,"x0":2500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2839","projName":"lcc","lat1":0.767944870877505,"lat2":0.738856050010933,"lat0":0.7272205216643038,"long0":-2.1031217486531673,"x0":1500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2840","projName":"tmerc","lat0":0.7170394343610039,"long0":-1.2479104151759457,"k0":0.99999375,"x0":100000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2841","projName":"lcc","lat1":0.7973245799527429,"lat2":0.7752170760941479,"lat0":0.765035988790848,"long0":-1.7453292519943295,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2842","projName":"lcc","lat1":0.7749261878854823,"lat2":0.7475826962709047,"lat0":0.738856050010933,"long0":-1.7511470161676435,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2843","projName":"lcc","lat1":0.6355907359346015,"lat2":0.6152285613280012,"lat0":0.5992297098513867,"long0":-1.5009831567151235,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2844","projName":"lcc","lat1":0.6315183010132815,"lat2":0.6047565858160352,"lat0":0.5934119456780721,"long0":-1.7715091907742444,"x0":200000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2845","projName":"lcc","lat1":0.5928301692607406,"lat2":0.5608324663075113,"lat0":0.5526875964648711,"long0":-1.7191493132144147,"x0":600000,"y0":2000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2846","projName":"lcc","lat1":0.5564691431775254,"lat2":0.525634993058959,"lat0":0.5177810114249846,"long0":-1.7511470161676435,"x0":700000,"y0":3000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2847","projName":"lcc","lat1":0.5285438751456161,"lat2":0.4953826193577238,"lat0":0.485783308471755,"long0":-1.7278759594743862,"x0":600000,"y0":4000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2848","projName":"lcc","lat1":0.485783308471755,"lat2":0.456694487605183,"lat0":0.44796784134521134,"long0":-1.7191493132144147,"x0":300000,"y0":5000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2849","projName":"lcc","lat1":0.729256739124964,"lat2":0.7106398937703579,"lat0":0.7039494649710464,"long0":-1.9460421159736774,"x0":500000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2850","projName":"lcc","lat1":0.7094763409356949,"lat2":0.6809692964864543,"lat0":0.6690428799311599,"long0":-1.9460421159736774,"x0":500000,"y0":2000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2851","projName":"lcc","lat1":0.6693337681398254,"lat2":0.6495533699505563,"lat0":0.6399540590645874,"long0":-1.9460421159736774,"x0":500000,"y0":3000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2852","projName":"tmerc","lat0":0.7417649320975901,"long0":-1.265363707695889,"k0":0.999964286,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2853","projName":"lcc","lat1":0.6841690667817772,"lat2":0.6638068921751766,"lat0":0.6574073515845307,"long0":-1.3700834628155487,"x0":3500000,"y0":2000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2854","projName":"lcc","lat1":0.6626433393405138,"lat2":0.6416993883165819,"lat0":0.6341362948912732,"long0":-1.3700834628155487,"x0":3500000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2855","projName":"lcc","lat1":0.8505571221385698,"lat2":0.8290313946973066,"lat0":0.8203047484373349,"long0":-2.108939512826481,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2856","projName":"lcc","lat1":0.8261225126106495,"lat2":0.7999425738307345,"lat0":0.7912159275707629,"long0":-2.1031217486531673,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2857","projName":"lcc","lat1":0.7024950239277177,"lat2":0.6806784082777885,"lat0":0.6719517620178169,"long0":-1.387536755335492,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2858","projName":"lcc","lat1":0.6786421908171285,"lat2":0.6542075812892078,"lat0":0.6457718232379019,"long0":-1.413716694115407,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2859","projName":"lcc","lat1":0.8162323135160149,"lat2":0.7952883624920829,"lat0":0.7883070454841054,"long0":-1.5707963267948966,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2860","projName":"lcc","lat1":0.7941248096574199,"lat2":0.7723081940074908,"lat0":0.765035988790848,"long0":-1.5707963267948966,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2861","projName":"lcc","lat1":0.7691084237121679,"lat2":0.74583736701891,"lat0":0.7330382858376184,"long0":-1.5707963267948966,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2862","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.8355045966807038,"k0":0.9999375,"x0":200000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2863","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.8733200638072465,"k0":0.9999375,"x0":400000,"y0":100000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2864","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.8980455615438334,"k0":0.9999375,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2865","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.9213166182370904,"k0":0.9999375,"x0":800000,"y0":100000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2866","projName":"lcc","lat1":0.321722358784288,"lat2":0.31474104177631074,"lat0":0.311250383272322,"long0":-1.1594803997415664,"x0":200000,"y0":200000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2867","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.9227710592804204,"k0":0.9999,"x0":213360,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"2868","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.953314321190321,"k0":0.9999,"x0":213360,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"2869","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.9853120241435498,"k0":0.999933333,"x0":213360,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"2870","projName":"lcc","lat1":0.7272205216643038,"lat2":0.6981317007977318,"lat0":0.6864961724511032,"long0":-2.129301687433082,"x0":2000000.0001016,"y0":500000.0001016001,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2871","projName":"lcc","lat1":0.6952228187110747,"lat2":0.6690428799311599,"lat0":0.6574073515845307,"long0":-2.129301687433082,"x0":2000000.0001016,"y0":500000.0001016001,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2872","projName":"lcc","lat1":0.670788209183154,"lat2":0.6469353760725649,"lat0":0.6370451769779303,"long0":-2.1031217486531673,"x0":2000000.0001016,"y0":500000.0001016001,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2873","projName":"lcc","lat1":0.6501351463678877,"lat2":0.6283185307179586,"lat0":0.6166830023713299,"long0":-2.076941809873252,"x0":2000000.0001016,"y0":500000.0001016001,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2874","projName":"lcc","lat1":0.6190101080406556,"lat2":0.5939937220954035,"lat0":0.5846852994181004,"long0":-2.059488517353309,"x0":2000000.0001016,"y0":500000.0001016001,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2875","projName":"lcc","lat1":0.591375728217412,"lat2":0.5721771064454744,"lat0":0.5614142427248425,"long0":-2.028945255443408,"x0":2000000.0001016,"y0":500000.0001016001,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2876","projName":"lcc","lat1":0.7118034466050207,"lat2":0.6931866012504145,"lat0":0.6864961724511032,"long0":-1.8413223608540177,"x0":914401.8288036576,"y0":304800.6096012192,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2877","projName":"lcc","lat1":0.693768377667746,"lat2":0.6710790973918198,"lat0":0.6603162336711882,"long0":-1.8413223608540177,"x0":914401.8288036576,"y0":304800.6096012192,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2878","projName":"lcc","lat1":0.670788209183154,"lat2":0.649844258159222,"lat0":0.6399540590645874,"long0":-1.8413223608540177,"x0":914401.8288036576,"y0":304800.6096012192,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2879","projName":"lcc","lat1":0.7307111801682926,"lat2":0.7190756518216638,"lat0":0.712676111231018,"long0":-1.2697270308258748,"x0":304800.6096012192,"y0":152400.3048006096,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2880","projName":"tmerc","lat0":0.6632251157578453,"long0":-1.3162691442123904,"k0":0.999995,"x0":200000.0001016002,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2881","projName":"tmerc","lat0":0.42469678465195343,"long0":-1.413716694115407,"k0":0.999941177,"x0":200000.0001016002,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2882","projName":"tmerc","lat0":0.42469678465195343,"long0":-1.4311699866353502,"k0":0.999941177,"x0":200000.0001016002,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2883","projName":"lcc","lat1":0.5366887449882564,"lat2":0.5163265703816557,"lat0":0.5061454830783556,"long0":-1.4748032179352084,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2884","projName":"tmerc","lat0":0.5235987755982988,"long0":-1.4340788687220076,"k0":0.9999,"x0":200000.0001016002,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2885","projName":"tmerc","lat0":0.5235987755982988,"long0":-1.468985453761894,"k0":0.9999,"x0":699999.9998983998,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2886","projName":"tmerc","lat0":0.7272205216643038,"long0":-1.957677644320307,"k0":0.999947368,"x0":200000.0001016002,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2887","projName":"tmerc","lat0":0.7272205216643038,"long0":-1.9896753472735358,"k0":0.999947368,"x0":500000.0001016001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2888","projName":"tmerc","lat0":0.7272205216643038,"long0":-2.0202186091834364,"k0":0.999933333,"x0":800000.0001016001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2889","projName":"tmerc","lat0":0.6544984694978736,"long0":-1.4951653925418091,"k0":0.999966667,"x0":99999.99989839978,"y0":249364.9987299975,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2890","projName":"tmerc","lat0":0.6544984694978736,"long0":-1.5198908902783952,"k0":0.999966667,"x0":900000,"y0":249364.9987299975,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2891","projName":"lcc","lat1":0.6626433393405138,"lat2":0.6800966318604571,"lat0":0.6544984694978736,"long0":-1.4704398948052226,"x0":500000.0001016001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2892","projName":"lcc","lat1":0.6620615629231823,"lat2":0.6411176118992503,"lat0":0.6341362948912732,"long0":-1.4966198335851375,"x0":500000.0001016001,"y0":500000.0001016001,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2893","projName":"lcc","lat1":0.688532389911763,"lat2":0.6684611035138281,"lat0":0.6574073515845307,"long0":-1.3439035240356338,"x0":399999.9998983998,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2894","projName":"lcc","lat1":0.7449647023929129,"lat2":0.7280931862903012,"lat0":0.7155849933176751,"long0":-1.2479104151759457,"x0":200000.0001016002,"y0":750000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2895","projName":"lcc","lat1":0.7240207513689809,"lat2":0.7205300928649924,"lat0":0.7155849933176751,"long0":-1.2304571226560024,"x0":500000.0001016001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2896","projName":"lcc","lat1":0.8217591894806636,"lat2":0.7938339214487541,"lat0":0.7816166166847939,"long0":-1.5184364492350666,"x0":7999999.999968001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"2897","projName":"lcc","lat1":0.7976154681614086,"lat2":0.7711446411728279,"lat0":0.7560184543222105,"long0":-1.4724761122658825,"x0":5999999.999976001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"2898","projName":"lcc","lat1":0.7621271067041904,"lat2":0.7347836150896128,"lat0":0.7243116395776468,"long0":-1.4724761122658825,"x0":3999999.999984,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"2899","projName":"tmerc","lat0":0.5148721293383273,"long0":-1.550434152188296,"k0":0.99995,"x0":300000.0000000001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2900","projName":"tmerc","lat0":0.5148721293383273,"long0":-1.576614090968211,"k0":0.99995,"x0":699999.9998983998,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2901","projName":"lcc","lat1":0.8552113334772214,"lat2":0.7853981633974483,"lat0":0.7723081940074908,"long0":-1.911135530933791,"x0":599999.9999976,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"2902","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.8209601862474165,"k0":0.999909091,"x0":165000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2903","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.8544123302439752,"k0":0.9999,"x0":500000.0001016001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2904","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.882046710067218,"k0":0.999916667,"x0":830000.0001016001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2905","projName":"tmerc","lat0":0.6777695261911315,"long0":-1.3002702927357754,"k0":0.9999,"x0":150000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2906","projName":"tmerc","lat0":0.6981317007977318,"long0":-1.3366313188189907,"k0":0.9999375,"x0":249999.9998983998,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2907","projName":"tmerc","lat0":0.6981317007977318,"long0":-1.3715379038588773,"k0":0.9999375,"x0":350000.0001016001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2908","projName":"lcc","lat1":0.7161667697350065,"lat2":0.7097672291443605,"lat0":0.7010405828843889,"long0":-1.2915436464758039,"x0":300000.0000000001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2909","projName":"lcc","lat1":0.8505571221385698,"lat2":0.8278678418626436,"lat0":0.8203047484373349,"long0":-1.7540558982543013,"x0":599999.9999976,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"2910","projName":"lcc","lat1":0.8287405064886407,"lat2":0.8060512262127145,"lat0":0.797033691744077,"long0":-1.7540558982543013,"x0":599999.9999976,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"2911","projName":"lcc","lat1":0.6416993883165819,"lat2":0.6207554372926499,"lat0":0.6108652381980153,"long0":-1.710422666954443,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2912","projName":"lcc","lat1":0.6149376731193353,"lat2":0.5922483928434091,"lat0":0.5817764173314434,"long0":-1.710422666954443,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2913","projName":"lcc","lat1":0.8028514559173916,"lat2":0.7737626350508195,"lat0":0.7621271067041904,"long0":-2.1031217486531673,"x0":2500000.0001424,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"2914","projName":"lcc","lat1":0.767944870877505,"lat2":0.738856050010933,"lat0":0.7272205216643038,"long0":-2.1031217486531673,"x0":1500000.0001464,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"2915","projName":"lcc","lat1":0.6355907359346015,"lat2":0.6152285613280012,"lat0":0.5992297098513867,"long0":-1.5009831567151235,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2916","projName":"lcc","lat1":0.6315183010132815,"lat2":0.6047565858160352,"lat0":0.5934119456780721,"long0":-1.7715091907742444,"x0":200000.0001016002,"y0":999999.9998983998,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2917","projName":"lcc","lat1":0.5928301692607406,"lat2":0.5608324663075113,"lat0":0.5526875964648711,"long0":-1.7191493132144147,"x0":600000,"y0":2000000.0001016,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2918","projName":"lcc","lat1":0.5564691431775254,"lat2":0.525634993058959,"lat0":0.5177810114249846,"long0":-1.7511470161676435,"x0":699999.9998983998,"y0":3000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2919","projName":"lcc","lat1":0.5285438751456161,"lat2":0.4953826193577238,"lat0":0.485783308471755,"long0":-1.7278759594743862,"x0":600000,"y0":3999999.9998984,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2920","projName":"lcc","lat1":0.485783308471755,"lat2":0.456694487605183,"lat0":0.44796784134521134,"long0":-1.7191493132144147,"x0":300000.0000000001,"y0":5000000.0001016,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2921","projName":"lcc","lat1":0.729256739124964,"lat2":0.7106398937703579,"lat0":0.7039494649710464,"long0":-1.9460421159736774,"x0":500000.0001504,"y0":999999.9999960001,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"2922","projName":"lcc","lat1":0.7094763409356949,"lat2":0.6809692964864543,"lat0":0.6690428799311599,"long0":-1.9460421159736774,"x0":500000.0001504,"y0":1999999.999992,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"2923","projName":"lcc","lat1":0.6693337681398254,"lat2":0.6495533699505563,"lat0":0.6399540590645874,"long0":-1.9460421159736774,"x0":500000.0001504,"y0":2999999.999988,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"2924","projName":"lcc","lat1":0.6841690667817772,"lat2":0.6638068921751766,"lat0":0.6574073515845307,"long0":-1.3700834628155487,"x0":3500000.0001016,"y0":2000000.0001016,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2925","projName":"lcc","lat1":0.6626433393405138,"lat2":0.6416993883165819,"lat0":0.6341362948912732,"long0":-1.3700834628155487,"x0":3500000.0001016,"y0":999999.9998983998,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2926","projName":"lcc","lat1":0.8505571221385698,"lat2":0.8290313946973066,"lat0":0.8203047484373349,"long0":-2.108939512826481,"x0":500000.0001016001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2927","projName":"lcc","lat1":0.8261225126106495,"lat2":0.7999425738307345,"lat0":0.7912159275707629,"long0":-2.1031217486531673,"x0":500000.0001016001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2928","projName":"lcc","lat1":0.8162323135160149,"lat2":0.7952883624920829,"lat0":0.7883070454841054,"long0":-1.5707963267948966,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2929","projName":"lcc","lat1":0.7941248096574199,"lat2":0.7723081940074908,"lat0":0.765035988790848,"long0":-1.5707963267948966,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2930","projName":"lcc","lat1":0.7691084237121679,"lat2":0.74583736701891,"lat0":0.7330382858376184,"long0":-1.5707963267948966,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2931","projName":"tmerc","lat0":0,"long0":0.22689280275926285,"k0":0.9996,"x0":500000,"y0":0,"a":"6378249.2","b":"6356515","datum_params":[-106,-87,188,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2932","projName":"tmerc","lat0":0.42673300211261356,"long0":0.8938994652297625,"k0":0.99999,"x0":200000,"y0":300000,"ellps":"intl","datum_params":[-119.425,-303.659,-11.0006,1.1643,0.174458,1.09626,3.65706],"units":"m","no_defs":true},{"EPSG":"2933","projName":"utm","zone":50,"utmSouth":true,"ellps":"bessel","datum_params":[-403,684,41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2934","projName":"merc","long0":1.9198621771937625,"k0":0.997,"x0":3900000,"y0":900000,"ellps":"bessel","datum_params":[-403,684,41,0,0,0,0],"from_greenwich":1.8641463708519166,"units":"m","no_defs":true},{"EPSG":"2935","projName":"tmerc","lat0":0.0020362174606600517,"long0":0.7248934159949781,"k0":1,"x0":1300000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2936","projName":"tmerc","lat0":0.0020362174606600517,"long0":0.7772532935548081,"k0":1,"x0":2300000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2937","projName":"tmerc","lat0":0.0020362174606600517,"long0":0.829613171114638,"k0":1,"x0":3300000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2938","projName":"tmerc","lat0":0.0020362174606600517,"long0":0.8819730486744678,"k0":1,"x0":4300000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2939","projName":"tmerc","lat0":0.002327105669325772,"long0":0.886045483595788,"k0":1,"x0":2300000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2940","projName":"tmerc","lat0":0.002327105669325772,"long0":0.938405361155618,"k0":1,"x0":3300000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2941","projName":"tmerc","lat0":0.002327105669325772,"long0":0.9907652387154479,"k0":1,"x0":4300000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"2942","projName":"utm","zone":28,"ellps":"intl","datum_params":[-499,-249,314,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2943","projName":"utm","zone":28,"ellps":"intl","datum_params":[-289,-124,60,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2944","projName":"tmerc","lat0":0,"long0":-0.9686577348568529,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2945","projName":"tmerc","lat0":0,"long0":-1.0210176124166828,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2946","projName":"tmerc","lat0":0,"long0":-1.0733774899765127,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2947","projName":"tmerc","lat0":0,"long0":-1.1257373675363425,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2948","projName":"tmerc","lat0":0,"long0":-1.1780972450961724,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2949","projName":"tmerc","lat0":0,"long0":-1.2304571226560024,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2950","projName":"tmerc","lat0":0,"long0":-1.2828170002158321,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2951","projName":"tmerc","lat0":0,"long0":-1.335176877775662,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2952","projName":"tmerc","lat0":0,"long0":-1.387536755335492,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2953","projName":"sterea","lat0":0.8115781021773633,"long0":-1.160643952576229,"k0":0.999912,"x0":2500000,"y0":7500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2954","projName":"sterea","lat0":0.8246680715673207,"long0":-1.0995574287564276,"k0":0.999912,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2955","projName":"utm","zone":11,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2956","projName":"utm","zone":12,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2957","projName":"utm","zone":13,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2958","projName":"utm","zone":17,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2959","projName":"utm","zone":18,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2960","projName":"utm","zone":19,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2961","projName":"utm","zone":20,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2962","projName":"utm","zone":21,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2964","projName":"aea","lat1":0.9599310885968813,"lat2":1.1344640137963142,"lat0":0.8726646259971648,"long0":-2.6878070480712677,"x0":0,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"2965","projName":"tmerc","lat0":0.6544984694978736,"long0":-1.4951653925418091,"k0":0.999966667,"x0":99999.99989839978,"y0":249999.9998983998,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2966","projName":"tmerc","lat0":0.6544984694978736,"long0":-1.5198908902783952,"k0":0.999966667,"x0":900000,"y0":249999.9998983998,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"2967","projName":"tmerc","lat0":0.6544984694978736,"long0":-1.4951653925418091,"k0":0.999966667,"x0":99999.99989839978,"y0":249999.9998983998,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2968","projName":"tmerc","lat0":0.6544984694978736,"long0":-1.5198908902783952,"k0":0.999966667,"x0":900000,"y0":249999.9998983998,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"2969","projName":"utm","zone":20,"ellps":"intl","datum_params":[137,248,-430,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2970","projName":"utm","zone":20,"ellps":"intl","datum_params":[-467,-16,-300,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2971","projName":"utm","zone":22,"ellps":"intl","datum_params":[-186,230,110,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2972","projName":"utm","zone":22,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2973","projName":"utm","zone":20,"ellps":"intl","datum_params":[186,482,151,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2975","projName":"utm","zone":40,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2976","projName":"utm","zone":6,"utmSouth":true,"ellps":"intl","datum_params":[162,117,154,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2977","projName":"utm","zone":5,"utmSouth":true,"ellps":"intl","datum_params":[72.438,345.918,79.486,1.6045,0.8823,0.5565,1.3746],"units":"m","no_defs":true},{"EPSG":"2978","projName":"utm","zone":7,"utmSouth":true,"ellps":"intl","datum_params":[84,274,65,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2979","projName":"utm","zone":42,"utmSouth":true,"ellps":"intl","datum_params":[145,-187,103,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2980","projName":"utm","zone":38,"utmSouth":true,"ellps":"intl","datum_params":[-382,-59,-262,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2981","projName":"utm","zone":58,"utmSouth":true,"ellps":"intl","datum_params":[335.47,222.58,-230.94,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2982","projName":"utm","zone":58,"utmSouth":true,"ellps":"intl","datum_params":[-13,-348,292,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2983","projName":"utm","zone":58,"utmSouth":true,"ellps":"intl","datum_params":[-122.383,-188.696,103.344,3.5107,-4.9668,-5.7047,4.4798],"units":"m","no_defs":true},{"EPSG":"2984","projName":"lcc","lat1":-0.36070137874549485,"lat2":-0.38979019961206685,"lat0":-0.3752457891787809,"long0":2.897246558310587,"x0":400000,"y0":300000,"ellps":"intl","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2987","projName":"utm","zone":21,"ellps":"clrk66","datum_params":[30,430,368,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2988","projName":"utm","zone":1,"utmSouth":true,"ellps":"intl","datum_params":[253,-132,-127,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2989","projName":"utm","zone":20,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2990","projName":"tmerc","lat0":-0.36855536037946934,"long0":0.9692395112741843,"k0":1,"x0":50000,"y0":160000,"ellps":"intl","datum_params":[94,-948,-1262,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2991","projName":"lcc","lat1":0.7504915783575618,"lat2":0.7941248096574199,"lat0":0.7286749627076325,"long0":-2.1031217486531673,"x0":400000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"2992","projName":"lcc","lat1":0.7504915783575618,"lat2":0.7941248096574199,"lat0":0.7286749627076325,"long0":-2.1031217486531673,"x0":399999.9999984,"y0":0,"datumCode":"NAD83","units":"ft","no_defs":true},{"EPSG":"2993","projName":"lcc","lat1":0.7504915783575618,"lat2":0.7941248096574199,"lat0":0.7286749627076325,"long0":-2.1031217486531673,"x0":400000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2994","projName":"lcc","lat1":0.7504915783575618,"lat2":0.7941248096574199,"lat0":0.7286749627076325,"long0":-2.1031217486531673,"x0":399999.9999984,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"2995","projName":"utm","zone":58,"utmSouth":true,"ellps":"intl","datum_params":[287.58,177.78,-135.41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2996","projName":"utm","zone":58,"utmSouth":true,"ellps":"intl","datum_params":[-13,-348,292,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2997","projName":"utm","zone":58,"utmSouth":true,"ellps":"intl","datum_params":[-480.26,-438.32,-643.429,16.3119,20.1721,-4.0349,-111.7],"units":"m","no_defs":true},{"EPSG":"2998","projName":"utm","zone":58,"utmSouth":true,"ellps":"intl","datum_params":[-10.18,-350.43,291.37,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"2999","projName":"utm","zone":38,"utmSouth":true,"ellps":"intl","datum_params":[-963,510,-359,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3000","projName":"merc","long0":1.9198621771937625,"k0":0.997,"x0":3900000,"y0":900000,"ellps":"bessel","datum_params":[-403,684,41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3001","projName":"merc","long0":1.9198621771937625,"k0":0.997,"x0":3900000,"y0":900000,"ellps":"bessel","datum_params":[-377,681,-50,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3002","projName":"merc","long0":1.9198621771937625,"k0":0.997,"x0":3900000,"y0":900000,"ellps":"bessel","datum_params":[-587.8,519.75,145.76,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3003","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":0.9996,"x0":1500000,"y0":0,"ellps":"intl","datum_params":[-104.1,-49.1,-9.9,0.971,-2.917,0.714,-11.68],"units":"m","no_defs":true},{"EPSG":"3004","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":0.9996,"x0":2520000,"y0":0,"ellps":"intl","datum_params":[-104.1,-49.1,-9.9,0.971,-2.917,0.714,-11.68],"units":"m","no_defs":true},{"EPSG":"3005","projName":"aea","lat1":0.8726646259971648,"lat2":1.0210176124166828,"lat0":0.7853981633974483,"long0":-2.199114857512855,"x0":1000000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3006","projName":"utm","zone":33,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3007","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":1,"x0":150000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3008","projName":"tmerc","lat0":0,"long0":0.23561944901923448,"k0":1,"x0":150000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3009","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":150000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3010","projName":"tmerc","lat0":0,"long0":0.2879793265790644,"k0":1,"x0":150000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3011","projName":"tmerc","lat0":0,"long0":0.3141592653589793,"k0":1,"x0":150000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3012","projName":"tmerc","lat0":0,"long0":0.24870941840919197,"k0":1,"x0":150000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3013","projName":"tmerc","lat0":0,"long0":0.2748893571891069,"k0":1,"x0":150000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3014","projName":"tmerc","lat0":0,"long0":0.3010692959690218,"k0":1,"x0":150000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3015","projName":"tmerc","lat0":0,"long0":0.3272492347489368,"k0":1,"x0":150000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3016","projName":"tmerc","lat0":0,"long0":0.3534291735288517,"k0":1,"x0":150000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3017","projName":"tmerc","lat0":0,"long0":0.37960911230876665,"k0":1,"x0":150000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3018","projName":"tmerc","lat0":0,"long0":0.40578905108868163,"k0":1,"x0":150000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3019","projName":"tmerc","lat0":0,"long0":0.19736667995232993,"k0":1,"x0":1500000,"y0":0,"ellps":"bessel","datum_params":[414.1,41.3,603.1,-0.855,2.141,-7.023,0],"units":"m","no_defs":true},{"EPSG":"3020","projName":"tmerc","lat0":0,"long0":0.23663658812220234,"k0":1,"x0":1500000,"y0":0,"ellps":"bessel","datum_params":[414.1,41.3,603.1,-0.855,2.141,-7.023,0],"units":"m","no_defs":true},{"EPSG":"3021","projName":"tmerc","lat0":0,"long0":0.27590649629207475,"k0":1,"x0":1500000,"y0":0,"ellps":"bessel","datum_params":[414.1,41.3,603.1,-0.855,2.141,-7.023,0],"units":"m","no_defs":true},{"EPSG":"3022","projName":"tmerc","lat0":0,"long0":0.3151764044619471,"k0":1,"x0":1500000,"y0":0,"ellps":"bessel","datum_params":[414.1,41.3,603.1,-0.855,2.141,-7.023,0],"units":"m","no_defs":true},{"EPSG":"3023","projName":"tmerc","lat0":0,"long0":0.3544463126318195,"k0":1,"x0":1500000,"y0":0,"ellps":"bessel","datum_params":[414.1,41.3,603.1,-0.855,2.141,-7.023,0],"units":"m","no_defs":true},{"EPSG":"3024","projName":"tmerc","lat0":0,"long0":0.39371622080169194,"k0":1,"x0":1500000,"y0":0,"ellps":"bessel","datum_params":[414.1,41.3,603.1,-0.855,2.141,-7.023,0],"units":"m","no_defs":true},{"EPSG":"3025","projName":"tmerc","lat0":0,"long0":0.19736667995232993,"k0":1,"x0":1500000,"y0":0,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"3026","projName":"tmerc","lat0":0,"long0":0.23663658812220234,"k0":1,"x0":1500000,"y0":0,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"3027","projName":"tmerc","lat0":0,"long0":0.27590649629207475,"k0":1,"x0":1500000,"y0":0,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"3028","projName":"tmerc","lat0":0,"long0":0.3151764044619471,"k0":1,"x0":1500000,"y0":0,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"3029","projName":"tmerc","lat0":0,"long0":0.3544463126318195,"k0":1,"x0":1500000,"y0":0,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"3030","projName":"tmerc","lat0":0,"long0":0.39371622080169194,"k0":1,"x0":1500000,"y0":0,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"3031","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.239183768915974,"long0":0,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3032","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.239183768915974,"long0":1.2217304763960306,"k0":1,"x0":6000000,"y0":6000000,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3033","projName":"lcc","lat1":-1.1955505376161157,"lat2":-1.3002702927357754,"lat0":-0.8726646259971648,"long0":1.2217304763960306,"x0":6000000,"y0":6000000,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3034","projName":"lcc","lat1":0.6108652381980153,"lat2":1.1344640137963142,"lat0":0.9075712110370514,"long0":0.17453292519943295,"x0":4000000,"y0":2800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3035","projName":"laea","lat0":0.9075712110370514,"long0":0.17453292519943295,"x0":4321000,"y0":3210000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3036","projName":"utm","zone":36,"utmSouth":true,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3037","projName":"utm","zone":37,"utmSouth":true,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3038","projName":"utm","zone":26,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3039","projName":"utm","zone":27,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3040","projName":"utm","zone":28,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3041","projName":"utm","zone":29,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3042","projName":"utm","zone":30,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3043","projName":"utm","zone":31,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3044","projName":"utm","zone":32,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3045","projName":"utm","zone":33,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3046","projName":"utm","zone":34,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3047","projName":"utm","zone":35,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3048","projName":"utm","zone":36,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3049","projName":"utm","zone":37,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3050","projName":"utm","zone":38,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3051","projName":"utm","zone":39,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3054","projName":"utm","zone":26,"ellps":"intl","datum_params":[-73,46,-86,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3055","projName":"utm","zone":27,"ellps":"intl","datum_params":[-73,46,-86,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3056","projName":"utm","zone":28,"ellps":"intl","datum_params":[-73,46,-86,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3057","projName":"lcc","lat1":1.1213740444063567,"lat2":1.1475539831862718,"lat0":1.1344640137963142,"long0":-0.33161255787892263,"x0":500000,"y0":500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3058","projName":"tmerc","lat0":0,"long0":-0.14835298641951802,"k0":1,"x0":50000,"y0":-7800000,"ellps":"intl","datum_params":[982.609,552.753,-540.873,6.68163,-31.6115,-19.8482,16.805],"units":"m","no_defs":true},{"EPSG":"3059","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":0.9996,"x0":500000,"y0":-6000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3060","projName":"utm","zone":58,"utmSouth":true,"ellps":"intl","datum_params":[-11.64,-348.6,291.98,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3061","projName":"utm","zone":28,"ellps":"intl","datum_params":[-502.862,-247.438,312.724,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3062","projName":"utm","zone":26,"ellps":"intl","datum_params":[-204.619,140.176,55.226,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3063","projName":"utm","zone":26,"ellps":"intl","datum_params":[-106.226,166.366,-37.893,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3064","projName":"utm","zone":32,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3065","projName":"utm","zone":33,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3066","projName":"tmerc","lat0":0,"long0":0.6457718232379019,"k0":0.9998,"x0":500000,"y0":-3000000,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3067","projName":"utm","zone":35,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3068","projName":"cass","lat0":0.9148780018920774,"long0":0.23783957182317725,"x0":40000,"y0":10000,"datumCode":"potsdam","units":"m","no_defs":true},{"EPSG":"3069","projName":"tmerc","lat0":0,"long0":-1.5707963267948966,"k0":0.9996,"x0":500000,"y0":-4500000,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"3070","projName":"tmerc","lat0":0,"long0":-1.5707963267948966,"k0":0.9996,"x0":520000,"y0":-4480000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3071","projName":"tmerc","lat0":0,"long0":-1.5707963267948966,"k0":0.9996,"x0":520000,"y0":-4480000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3072","projName":"tmerc","lat0":0.765035988790848,"long0":-1.1846422297911512,"k0":0.99998,"x0":700000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3073","projName":"tmerc","lat0":0.7504915783575618,"long0":-1.2064588454410803,"k0":0.99998,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3074","projName":"tmerc","lat0":0.7475826962709047,"long0":-1.2282754610910094,"k0":0.99998,"x0":300000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3075","projName":"tmerc","lat0":0.765035988790848,"long0":-1.1846422297911512,"k0":0.99998,"x0":700000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3076","projName":"tmerc","lat0":0.7504915783575618,"long0":-1.2064588454410803,"k0":0.99998,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3077","projName":"tmerc","lat0":0.7475826962709047,"long0":-1.2282754610910094,"k0":0.99998,"x0":300000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3078","projName":"omerc","lat0":0.7907941396681973,"longc":-1.5009831567151235,"alpha":5.886219942657287,"k0":0.9996,"x0":2546731.496,"y0":-4354009.816,"no_uoff":true,"gamma":"337.25556","datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3079","projName":"omerc","lat0":0.7907941396681973,"longc":-1.5009831567151235,"alpha":5.886219942657287,"k0":0.9996,"x0":2546731.496,"y0":-4354009.816,"no_uoff":true,"gamma":"337.25556","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3080","projName":"lcc","lat1":0.4785111032551121,"lat2":0.6094107971546866,"lat0":0.5439609502048994,"long0":-1.7453292519943295,"x0":914400,"y0":914400,"datumCode":"NAD27","units":"ft","no_defs":true},{"EPSG":"3081","projName":"lcc","lat1":0.4785111032551121,"lat2":0.6094107971546866,"lat0":0.5439609502048994,"long0":-1.7453292519943295,"x0":1000000,"y0":1000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3082","projName":"lcc","lat1":0.4799655442984406,"lat2":0.6108652381980153,"lat0":0.3141592653589793,"long0":-1.7453292519943295,"x0":1500000,"y0":5000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3083","projName":"aea","lat1":0.4799655442984406,"lat2":0.6108652381980153,"lat0":0.3141592653589793,"long0":-1.7453292519943295,"x0":1500000,"y0":6000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3084","projName":"lcc","lat1":0.4799655442984406,"lat2":0.6108652381980153,"lat0":0.3141592653589793,"long0":-1.7453292519943295,"x0":1500000,"y0":5000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3085","projName":"aea","lat1":0.4799655442984406,"lat2":0.6108652381980153,"lat0":0.3141592653589793,"long0":-1.7453292519943295,"x0":1500000,"y0":6000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3086","projName":"aea","lat1":0.4188790204786391,"lat2":0.5497787143782138,"lat0":0.4188790204786391,"long0":-1.4660765716752369,"x0":400000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3087","projName":"aea","lat1":0.4188790204786391,"lat2":0.5497787143782138,"lat0":0.4188790204786391,"long0":-1.4660765716752369,"x0":400000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3088","projName":"lcc","lat1":0.6472262642812308,"lat2":0.6748606441044739,"lat0":0.6341362948912732,"long0":-1.4966198335851375,"x0":1500000,"y0":1000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3089","projName":"lcc","lat1":0.6472262642812308,"lat2":0.6748606441044739,"lat0":0.6341362948912732,"long0":-1.4966198335851375,"x0":1500000,"y0":999999.9998983998,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3090","projName":"lcc","lat1":0.6472262642812308,"lat2":0.6748606441044739,"lat0":0.6341362948912732,"long0":-1.4966198335851375,"x0":1500000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3091","projName":"lcc","lat1":0.6472262642812308,"lat2":0.6748606441044739,"lat0":0.6341362948912732,"long0":-1.4966198335851375,"x0":1500000,"y0":999999.9998983998,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3092","projName":"utm","zone":51,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3093","projName":"utm","zone":52,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3094","projName":"utm","zone":53,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3095","projName":"utm","zone":54,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3096","projName":"utm","zone":55,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3097","projName":"utm","zone":51,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3098","projName":"utm","zone":52,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3099","projName":"utm","zone":53,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3100","projName":"utm","zone":54,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3101","projName":"utm","zone":55,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3102","projName":"lcc","lat1":-0.24900030661785771,"lat0":-0.24900030661785771,"long0":-2.9670597283903604,"k0":1,"x0":152400.3048006096,"y0":95169.31165862332,"ellps":"clrk66","datum_params":[-115,118,426,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3103","projName":"utm","zone":28,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"3104","projName":"utm","zone":29,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"3105","projName":"utm","zone":30,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"3106","projName":"tmerc","lat0":0,"long0":1.5707963267948966,"k0":0.9996,"x0":500000,"y0":0,"a":"6377276.345","b":"6356075.41314024","datum_params":[283.7,735.9,261.1,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3107","projName":"lcc","lat1":-0.4886921905584123,"lat2":-0.6283185307179586,"lat0":-0.5585053606381855,"long0":2.356194490192345,"x0":1000000,"y0":2000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3108","projName":"tmerc","lat0":0.8639379797371931,"long0":-0.04217879025652964,"k0":0.999997,"x0":47000,"y0":50000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3109","projName":"tmerc","lat0":0.8591383242942088,"long0":-0.037262779530078935,"k0":0.9999999,"x0":40000,"y0":70000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3110","projName":"lcc","lat1":-0.6283185307179586,"lat2":-0.6632251157578453,"lat0":-0.6457718232379019,"long0":2.530727415391778,"x0":2500000,"y0":4500000,"ellps":"aust_SA","datum_params":[-117.808,-51.536,137.784,0.303,0.446,0.234,-0.29],"units":"m","no_defs":true},{"EPSG":"3111","projName":"lcc","lat1":-0.6283185307179586,"lat2":-0.6632251157578453,"lat0":-0.6457718232379019,"long0":2.530727415391778,"x0":2500000,"y0":2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3112","projName":"lcc","lat1":-0.3141592653589793,"lat2":-0.6283185307179586,"lat0":0,"long0":2.3387411976724017,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3113","projName":"tmerc","lat0":-0.4886921905584123,"long0":2.670353755551324,"k0":0.99999,"x0":50000,"y0":100000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3114","projName":"tmerc","lat0":0.08021883035236858,"long0":-1.3976161699376584,"k0":1,"x0":1000000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3115","projName":"tmerc","lat0":0.08021883035236858,"long0":-1.3452562923778284,"k0":1,"x0":1000000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3116","projName":"tmerc","lat0":0.08021883035236858,"long0":-1.2928964148179984,"k0":1,"x0":1000000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3117","projName":"tmerc","lat0":0.08021883035236858,"long0":-1.2405365372581687,"k0":1,"x0":1000000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3118","projName":"tmerc","lat0":0.08021883035236858,"long0":-1.1881766596983387,"k0":1,"x0":1000000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3119","projName":"tmerc","lat0":0,"long0":0.1832595714594046,"k0":0.999,"x0":1000000,"y0":1000000,"ellps":"intl","datum_params":[-206.1,-174.7,-87.7,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3120","projName":"sterea","lat0":0.8835729338221293,"long0":0.36797358396213775,"k0":0.9998,"x0":4637000,"y0":5467000,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"3121","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":0.99995,"x0":500000,"y0":0,"ellps":"clrk66","datum_params":[-127.62,-67.24,-47.04,-3.068,4.903,1.578,-1.06],"units":"m","no_defs":true},{"EPSG":"3122","projName":"tmerc","lat0":0,"long0":2.076941809873252,"k0":0.99995,"x0":500000,"y0":0,"ellps":"clrk66","datum_params":[-127.62,-67.24,-47.04,-3.068,4.903,1.578,-1.06],"units":"m","no_defs":true},{"EPSG":"3123","projName":"tmerc","lat0":0,"long0":2.111848394913139,"k0":0.99995,"x0":500000,"y0":0,"ellps":"clrk66","datum_params":[-127.62,-67.24,-47.04,-3.068,4.903,1.578,-1.06],"units":"m","no_defs":true},{"EPSG":"3124","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":0.99995,"x0":500000,"y0":0,"ellps":"clrk66","datum_params":[-127.62,-67.24,-47.04,-3.068,4.903,1.578,-1.06],"units":"m","no_defs":true},{"EPSG":"3125","projName":"tmerc","lat0":0,"long0":2.181661564992912,"k0":0.99995,"x0":500000,"y0":0,"ellps":"clrk66","datum_params":[-127.62,-67.24,-47.04,-3.068,4.903,1.578,-1.06],"units":"m","no_defs":true},{"EPSG":"3126","projName":"tmerc","lat0":0,"long0":0.33161255787892263,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3127","projName":"tmerc","lat0":0,"long0":0.3490658503988659,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3128","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3129","projName":"tmerc","lat0":0,"long0":0.3839724354387525,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3130","projName":"tmerc","lat0":0,"long0":0.4014257279586958,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3131","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3132","projName":"tmerc","lat0":0,"long0":0.4363323129985824,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3133","projName":"tmerc","lat0":0,"long0":0.4537856055185257,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3134","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3135","projName":"tmerc","lat0":0,"long0":0.4886921905584123,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3136","projName":"tmerc","lat0":0,"long0":0.5061454830783556,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3137","projName":"tmerc","lat0":0,"long0":0.5235987755982988,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3138","projName":"tmerc","lat0":0,"long0":0.5410520681182421,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3140","projName":"cass","lat0":-0.3141592653589793,"long0":3.1066860685499065,"x0":109435.392,"y0":141622.272,"a":"6378306.3696","b":"6356571.996","datum_params":[51,391,-36,0,0,0,0],"to_meter":0.201168,"no_defs":true},{"EPSG":"3141","projName":"utm","zone":60,"utmSouth":true,"ellps":"intl","datum_params":[265.025,384.929,-194.046,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3142","projName":"utm","zone":1,"utmSouth":true,"ellps":"intl","datum_params":[265.025,384.929,-194.046,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3143","projName":"tmerc","lat0":-0.29670597283903605,"long0":3.119776037939864,"k0":0.99985,"x0":2000000,"y0":4000000,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"3146","projName":"tmerc","lat0":0,"long0":0.3141592653589793,"k0":1,"x0":6500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"3147","projName":"tmerc","lat0":0,"long0":0.3141592653589793,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"3148","projName":"utm","zone":48,"a":"6377276.345","b":"6356075.41314024","datum_params":[198,881,317,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3149","projName":"utm","zone":49,"a":"6377276.345","b":"6356075.41314024","datum_params":[198,881,317,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3150","projName":"tmerc","lat0":0,"long0":0.3141592653589793,"k0":1,"x0":6500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"3151","projName":"tmerc","lat0":0,"long0":0.3141592653589793,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"3152","projName":"tmerc","lat0":0,"long0":0.31516789113370686,"k0":0.99999425,"x0":100178.1808,"y0":-6500614.7836,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3153","projName":"aea","lat1":0.8726646259971648,"lat2":1.0210176124166828,"lat0":0.7853981633974483,"long0":-2.199114857512855,"x0":1000000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3154","projName":"utm","zone":7,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3155","projName":"utm","zone":8,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3156","projName":"utm","zone":9,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3157","projName":"utm","zone":10,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3158","projName":"utm","zone":14,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3159","projName":"utm","zone":15,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3160","projName":"utm","zone":16,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3161","projName":"lcc","lat1":0.7766715171374766,"lat2":0.9337511498169663,"lat0":0,"long0":-1.4835298641951802,"x0":930000,"y0":6430000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3162","projName":"lcc","lat1":0.7766715171374766,"lat2":0.9337511498169663,"lat0":0,"long0":-1.4835298641951802,"x0":930000,"y0":6430000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3163","projName":"lcc","lat1":-0.36070137874549485,"lat2":-0.38979019961206685,"lat0":-0.3752457891787809,"long0":2.897246558310587,"x0":400000,"y0":300000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3164","projName":"utm","zone":58,"utmSouth":true,"ellps":"WGS84","datum_params":[-56.263,16.136,-22.856,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3165","projName":"lcc","lat1":-0.38824311212871937,"lat2":-0.3891157767547165,"lat0":-0.3886794444417179,"long0":2.9049683443436924,"x0":0.66,"y0":1.02,"ellps":"intl","datum_params":[-10.18,-350.43,291.37,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3166","projName":"lcc","lat1":-0.3882436439693275,"lat2":-0.38911630859532464,"lat0":-0.3886799762823261,"long0":2.9049696402506617,"x0":8.313,"y0":-2.354,"ellps":"intl","datum_params":[-10.18,-350.43,291.37,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3167","projName":"omerc","lat0":0.06981317007977318,"longc":1.784599160164202,"alpha":5.637863613082421,"k0":0.99984,"x0":40000,"y0":0,"no_uoff":true,"gamma":"323.1301023611111","a":"6377295.664","b":"6356094.667915204","to_meter":20.116756,"no_defs":true},{"EPSG":"3168","projName":"omerc","lat0":0.06981317007977318,"longc":1.784599160164202,"alpha":5.637863613082421,"k0":0.99984,"x0":804670.24,"y0":0,"no_uoff":true,"gamma":"323.1301023611111","a":"6377295.664","b":"6356094.667915204","units":"m","no_defs":true},{"EPSG":"3169","projName":"utm","zone":57,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3170","projName":"utm","zone":58,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3171","projName":"utm","zone":59,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3172","projName":"utm","zone":59,"utmSouth":true,"ellps":"intl","datum_params":[287.58,177.78,-135.41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3174","projName":"aea","lat1":0.735181096373462,"lat2":0.8554762744576743,"lat0":0.795328685415568,"long0":-1.4740344876661675,"x0":1000000,"y0":1000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3175","projName":"aea","lat1":0.735181096373462,"lat2":0.8554762744576743,"lat0":0.795328685415568,"long0":-1.4529626389146495,"x0":1000000,"y0":1000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3176","projName":"tmerc","lat0":0,"long0":1.8500490071139892,"k0":0.9996,"x0":500000,"y0":0,"a":"6377276.345","b":"6356075.41314024","datum_params":[198,881,317,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3177","projName":"tmerc","lat0":0,"long0":0.29670597283903605,"k0":0.9965,"x0":1000000,"y0":0,"ellps":"intl","datum_params":[-208.406,-109.878,-2.5764,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3178","projName":"utm","zone":18,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3179","projName":"utm","zone":19,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3180","projName":"utm","zone":20,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3181","projName":"utm","zone":21,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3182","projName":"utm","zone":22,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3183","projName":"utm","zone":23,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3184","projName":"utm","zone":24,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3185","projName":"utm","zone":25,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3186","projName":"utm","zone":26,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3187","projName":"utm","zone":27,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3188","projName":"utm","zone":28,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3189","projName":"utm","zone":29,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3190","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":0.99995,"x0":200000,"y0":0,"ellps":"intl","datum_params":[-208.406,-109.878,-2.5764,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3191","projName":"tmerc","lat0":0,"long0":0.19198621771937624,"k0":0.99995,"x0":200000,"y0":0,"ellps":"intl","datum_params":[-208.406,-109.878,-2.5764,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3192","projName":"tmerc","lat0":0,"long0":0.22689280275926285,"k0":0.99995,"x0":200000,"y0":0,"ellps":"intl","datum_params":[-208.406,-109.878,-2.5764,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3193","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":0.99995,"x0":200000,"y0":0,"ellps":"intl","datum_params":[-208.406,-109.878,-2.5764,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3194","projName":"tmerc","lat0":0,"long0":0.29670597283903605,"k0":0.99995,"x0":200000,"y0":0,"ellps":"intl","datum_params":[-208.406,-109.878,-2.5764,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3195","projName":"tmerc","lat0":0,"long0":0.33161255787892263,"k0":0.99995,"x0":200000,"y0":0,"ellps":"intl","datum_params":[-208.406,-109.878,-2.5764,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3196","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":0.99995,"x0":200000,"y0":0,"ellps":"intl","datum_params":[-208.406,-109.878,-2.5764,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3197","projName":"tmerc","lat0":0,"long0":0.4014257279586958,"k0":0.99995,"x0":200000,"y0":0,"ellps":"intl","datum_params":[-208.406,-109.878,-2.5764,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3198","projName":"tmerc","lat0":0,"long0":0.4363323129985824,"k0":0.99995,"x0":200000,"y0":0,"ellps":"intl","datum_params":[-208.406,-109.878,-2.5764,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3199","projName":"utm","zone":32,"ellps":"intl","datum_params":[-208.406,-109.878,-2.5764,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3200","projName":"lcc","lat1":0.5672320068981571,"lat0":0.5672320068981571,"long0":0.7853981633974483,"k0":0.9987864078,"x0":1500000,"y0":1166200,"ellps":"clrk80","datum_params":[-241.54,-163.64,396.06,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3201","projName":"utm","zone":33,"ellps":"intl","datum_params":[-208.406,-109.878,-2.5764,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3202","projName":"utm","zone":34,"ellps":"intl","datum_params":[-208.406,-109.878,-2.5764,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3203","projName":"utm","zone":35,"ellps":"intl","datum_params":[-208.406,-109.878,-2.5764,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3204","projName":"lcc","lat1":-1.0588330795432264,"lat2":-1.1053751929297422,"lat0":-1.5707963267948966,"long0":-1.1519173063162575,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3205","projName":"lcc","lat1":-1.0588330795432264,"lat2":-1.1053751929297422,"lat0":-1.5707963267948966,"long0":-0.9424777960769379,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3206","projName":"lcc","lat1":-1.0588330795432264,"lat2":-1.1053751929297422,"lat0":-1.5707963267948966,"long0":-0.7330382858376184,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3207","projName":"lcc","lat1":-1.1286462496229999,"lat2":-1.1751883630095152,"lat0":-1.5707963267948966,"long0":-3.036872898470133,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3208","projName":"lcc","lat1":-1.1286462496229999,"lat2":-1.1751883630095152,"lat0":-1.5707963267948966,"long0":-1.1519173063162575,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3209","projName":"lcc","lat1":-1.1286462496229999,"lat2":-1.1751883630095152,"lat0":-1.5707963267948966,"long0":-0.9424777960769379,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3210","projName":"lcc","lat1":-1.1286462496229999,"lat2":-1.1751883630095152,"lat0":-1.5707963267948966,"long0":0.7330382858376184,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3211","projName":"lcc","lat1":-1.1286462496229999,"lat2":-1.1751883630095152,"lat0":-1.5707963267948966,"long0":0.9424777960769379,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3212","projName":"lcc","lat1":-1.1286462496229999,"lat2":-1.1751883630095152,"lat0":-1.5707963267948966,"long0":1.1519173063162575,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3213","projName":"lcc","lat1":-1.1286462496229999,"lat2":-1.1751883630095152,"lat0":-1.5707963267948966,"long0":1.361356816555577,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3214","projName":"lcc","lat1":-1.1286462496229999,"lat2":-1.1751883630095152,"lat0":-1.5707963267948966,"long0":1.5707963267948966,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3215","projName":"lcc","lat1":-1.1286462496229999,"lat2":-1.1751883630095152,"lat0":-1.5707963267948966,"long0":1.7802358370342162,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3216","projName":"lcc","lat1":-1.1286462496229999,"lat2":-1.1751883630095152,"lat0":-1.5707963267948966,"long0":1.9896753472735358,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3217","projName":"lcc","lat1":-1.1286462496229999,"lat2":-1.1751883630095152,"lat0":-1.5707963267948966,"long0":2.199114857512855,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3218","projName":"lcc","lat1":-1.1286462496229999,"lat2":-1.1751883630095152,"lat0":-1.5707963267948966,"long0":2.4085543677521746,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3219","projName":"lcc","lat1":-1.1286462496229999,"lat2":-1.1751883630095152,"lat0":-1.5707963267948966,"long0":2.6179938779914944,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3220","projName":"lcc","lat1":-1.1286462496229999,"lat2":-1.1751883630095152,"lat0":-1.5707963267948966,"long0":2.827433388230814,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3221","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":-1.7802358370342162,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3222","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":-1.5707963267948966,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3223","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":-1.361356816555577,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3224","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":-1.1519173063162575,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3225","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":-0.3141592653589793,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3226","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":-0.10471975511965978,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3227","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":0.10471975511965978,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3228","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":0.3141592653589793,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3229","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":0.5235987755982988,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3230","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":0.7330382858376184,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3231","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":0.9424777960769379,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3232","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":1.1519173063162575,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3233","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":1.361356816555577,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3234","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":1.5707963267948966,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3235","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":1.7802358370342162,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3236","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":1.9896753472735358,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3237","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":2.199114857512855,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3238","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":2.4085543677521746,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3239","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":2.6179938779914944,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3240","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":2.827433388230814,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3241","projName":"lcc","lat1":-1.1984594197027731,"lat2":-1.2450015330892883,"lat0":-1.5707963267948966,"long0":3.036872898470133,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3242","projName":"lcc","lat1":-1.2682725897825462,"lat2":-1.3148147031690616,"lat0":-1.5707963267948966,"long0":-2.670353755551324,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3243","projName":"lcc","lat1":-1.2682725897825462,"lat2":-1.3148147031690616,"lat0":-1.5707963267948966,"long0":-2.356194490192345,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3244","projName":"lcc","lat1":-1.2682725897825462,"lat2":-1.3148147031690616,"lat0":-1.5707963267948966,"long0":-2.0420352248333655,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3245","projName":"lcc","lat1":-1.2682725897825462,"lat2":-1.3148147031690616,"lat0":-1.5707963267948966,"long0":-1.7278759594743862,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3246","projName":"lcc","lat1":-1.2682725897825462,"lat2":-1.3148147031690616,"lat0":-1.5707963267948966,"long0":-1.413716694115407,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3247","projName":"lcc","lat1":-1.2682725897825462,"lat2":-1.3148147031690616,"lat0":-1.5707963267948966,"long0":-1.0995574287564276,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3248","projName":"lcc","lat1":-1.2682725897825462,"lat2":-1.3148147031690616,"lat0":-1.5707963267948966,"long0":-0.47123889803846897,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3249","projName":"lcc","lat1":-1.2682725897825462,"lat2":-1.3148147031690616,"lat0":-1.5707963267948966,"long0":-0.15707963267948966,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3250","projName":"lcc","lat1":-1.2682725897825462,"lat2":-1.3148147031690616,"lat0":-1.5707963267948966,"long0":0.15707963267948966,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3251","projName":"lcc","lat1":-1.2682725897825462,"lat2":-1.3148147031690616,"lat0":-1.5707963267948966,"long0":0.47123889803846897,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3252","projName":"lcc","lat1":-1.2682725897825462,"lat2":-1.3148147031690616,"lat0":-1.5707963267948966,"long0":0.7853981633974483,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3253","projName":"lcc","lat1":-1.2682725897825462,"lat2":-1.3148147031690616,"lat0":-1.5707963267948966,"long0":1.0995574287564276,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3254","projName":"lcc","lat1":-1.2682725897825462,"lat2":-1.3148147031690616,"lat0":-1.5707963267948966,"long0":1.413716694115407,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3255","projName":"lcc","lat1":-1.2682725897825462,"lat2":-1.3148147031690616,"lat0":-1.5707963267948966,"long0":1.7278759594743862,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3256","projName":"lcc","lat1":-1.2682725897825462,"lat2":-1.3148147031690616,"lat0":-1.5707963267948966,"long0":2.0420352248333655,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3257","projName":"lcc","lat1":-1.2682725897825462,"lat2":-1.3148147031690616,"lat0":-1.5707963267948966,"long0":2.356194490192345,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3258","projName":"lcc","lat1":-1.2682725897825462,"lat2":-1.3148147031690616,"lat0":-1.5707963267948966,"long0":2.670353755551324,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3259","projName":"lcc","lat1":-1.2682725897825462,"lat2":-1.3148147031690616,"lat0":-1.5707963267948966,"long0":2.9845130209103035,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3260","projName":"lcc","lat1":-1.3380857598623195,"lat2":-1.3846278732488346,"lat0":-1.5707963267948966,"long0":-2.9321531433504737,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3261","projName":"lcc","lat1":-1.3380857598623195,"lat2":-1.3846278732488346,"lat0":-1.5707963267948966,"long0":-2.5132741228718345,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3262","projName":"lcc","lat1":-1.3380857598623195,"lat2":-1.3846278732488346,"lat0":-1.5707963267948966,"long0":-2.0943951023931953,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3263","projName":"lcc","lat1":-1.3380857598623195,"lat2":-1.3846278732488346,"lat0":-1.5707963267948966,"long0":-1.6755160819145565,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3264","projName":"lcc","lat1":-1.3380857598623195,"lat2":-1.3846278732488346,"lat0":-1.5707963267948966,"long0":-1.2566370614359172,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3265","projName":"lcc","lat1":-1.3380857598623195,"lat2":-1.3846278732488346,"lat0":-1.5707963267948966,"long0":-0.8377580409572782,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3266","projName":"lcc","lat1":-1.3380857598623195,"lat2":-1.3846278732488346,"lat0":-1.5707963267948966,"long0":-0.4188790204786391,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3267","projName":"lcc","lat1":-1.3380857598623195,"lat2":-1.3846278732488346,"lat0":-1.5707963267948966,"long0":0,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3268","projName":"lcc","lat1":-1.3380857598623195,"lat2":-1.3846278732488346,"lat0":-1.5707963267948966,"long0":0.4188790204786391,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3269","projName":"lcc","lat1":-1.3380857598623195,"lat2":-1.3846278732488346,"lat0":-1.5707963267948966,"long0":0.8377580409572782,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3270","projName":"lcc","lat1":-1.3380857598623195,"lat2":-1.3846278732488346,"lat0":-1.5707963267948966,"long0":1.2566370614359172,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3271","projName":"lcc","lat1":-1.3380857598623195,"lat2":-1.3846278732488346,"lat0":-1.5707963267948966,"long0":1.6755160819145565,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3272","projName":"lcc","lat1":-1.3380857598623195,"lat2":-1.3846278732488346,"lat0":-1.5707963267948966,"long0":2.0943951023931953,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3273","projName":"lcc","lat1":-1.3380857598623195,"lat2":-1.3846278732488346,"lat0":-1.5707963267948966,"long0":2.5132741228718345,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3274","projName":"lcc","lat1":-1.3380857598623195,"lat2":-1.3846278732488346,"lat0":-1.5707963267948966,"long0":2.9321531433504737,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3275","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.4004279511161946,"long0":-2.8797932657906435,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3276","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.4004279511161946,"long0":-2.356194490192345,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3277","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.4004279511161946,"long0":-1.8325957145940461,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3278","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.4004279511161946,"long0":-1.3089969389957472,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3279","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.4004279511161946,"long0":-0.7853981633974483,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3280","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.4004279511161946,"long0":-0.2617993877991494,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3281","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.4004279511161946,"long0":0.2617993877991494,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3282","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.4004279511161946,"long0":0.7853981633974483,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3283","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.4004279511161946,"long0":1.3089969389957472,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3284","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.4004279511161946,"long0":1.8325957145940461,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3285","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.4004279511161946,"long0":2.356194490192345,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3286","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.4004279511161946,"long0":2.8797932657906435,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3287","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.4004279511161946,"long0":-2.6179938779914944,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3288","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.4004279511161946,"long0":-1.5707963267948966,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3289","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.4004279511161946,"long0":-0.5235987755982988,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3290","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.4004279511161946,"long0":0.5235987755982988,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3291","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.4004279511161946,"long0":1.5707963267948966,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3292","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.4004279511161946,"long0":2.6179938779914944,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3293","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.4004279511161946,"long0":0,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3294","projName":"lcc","lat1":-1.3380857598623195,"lat2":-1.3846278732488346,"lat0":-1.361356816555577,"long0":2.827433388230814,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3296","projName":"utm","zone":5,"utmSouth":true,"ellps":"GRS80","datum_params":[0.072,-0.507,-0.245,-0.0183,0.0003,-0.007,-0.0093],"units":"m","no_defs":true},{"EPSG":"3297","projName":"utm","zone":6,"utmSouth":true,"ellps":"GRS80","datum_params":[0.072,-0.507,-0.245,-0.0183,0.0003,-0.007,-0.0093],"units":"m","no_defs":true},{"EPSG":"3298","projName":"utm","zone":7,"utmSouth":true,"ellps":"GRS80","datum_params":[0.072,-0.507,-0.245,-0.0183,0.0003,-0.007,-0.0093],"units":"m","no_defs":true},{"EPSG":"3299","projName":"utm","zone":8,"utmSouth":true,"ellps":"GRS80","datum_params":[0.072,-0.507,-0.245,-0.0183,0.0003,-0.007,-0.0093],"units":"m","no_defs":true},{"EPSG":"3300","projName":"lcc","lat1":1.0355620228499691,"lat2":1.0122909661567112,"lat0":1.0038706937816004,"long0":0.4188790204786391,"x0":500000,"y0":6375000,"ellps":"GRS80","datum_params":[0.055,-0.541,-0.185,0.0183,-0.0003,-0.007,-0.014],"units":"m","no_defs":true},{"EPSG":"3301","projName":"lcc","lat1":1.0355620228499691,"lat2":1.0122909661567112,"lat0":1.0038706937816004,"long0":0.4188790204786391,"x0":500000,"y0":6375000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3302","projName":"utm","zone":7,"utmSouth":true,"ellps":"intl","datum_params":[410.721,55.049,80.746,2.5779,2.3514,0.6664,17.3311],"units":"m","no_defs":true},{"EPSG":"3303","projName":"utm","zone":7,"utmSouth":true,"ellps":"intl","datum_params":[347.103,1078.12,2623.92,-33.8875,70.6773,-9.3943,186.074],"units":"m","no_defs":true},{"EPSG":"3304","projName":"utm","zone":6,"utmSouth":true,"ellps":"intl","datum_params":[221.525,152.948,176.768,-2.3847,-1.3896,-0.877,11.4741],"units":"m","no_defs":true},{"EPSG":"3305","projName":"utm","zone":6,"utmSouth":true,"ellps":"intl","datum_params":[215.525,149.593,176.229,-3.2624,-1.692,-1.1571,10.4773],"units":"m","no_defs":true},{"EPSG":"3306","projName":"utm","zone":5,"utmSouth":true,"ellps":"intl","datum_params":[217.037,86.959,23.956,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3307","projName":"utm","zone":39,"ellps":"WGS84","datum_params":[0,-0.15,0.68,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3308","projName":"lcc","lat1":-0.5366887449882564,"lat2":-0.6239552075879728,"lat0":-0.5803219762881145,"long0":2.5656340004316642,"x0":9300000,"y0":4500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3309","projName":"aea","lat1":0.5934119456780721,"lat2":0.7068583470577035,"lat0":0,"long0":-2.0943951023931953,"x0":0,"y0":-4000000,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"3310","projName":"aea","lat1":0.5934119456780721,"lat2":0.7068583470577035,"lat0":0,"long0":-2.0943951023931953,"x0":0,"y0":-4000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3311","projName":"aea","lat1":0.5934119456780721,"lat2":0.7068583470577035,"lat0":0,"long0":-2.0943951023931953,"x0":0,"y0":-4000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3312","projName":"utm","zone":21,"ellps":"intl","datum_params":[-186,230,110,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3313","projName":"utm","zone":21,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3314","projName":"lcc","lat1":-0.11344640137963143,"lat2":-0.2007128639793479,"lat0":0,"long0":0.4537856055185257,"x0":0,"y0":0,"ellps":"clrk66","datum_params":[-103.746,-9.614,-255.95,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3315","projName":"tmerc","lat0":-0.15707963267948966,"long0":0.4537856055185257,"k0":0.9998,"x0":0,"y0":0,"ellps":"clrk66","datum_params":[-103.746,-9.614,-255.95,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3316","projName":"tmerc","lat0":0,"long0":0.3839724354387525,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"3317","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"3318","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"3319","projName":"tmerc","lat0":0,"long0":0.24434609527920614,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"3320","projName":"tmerc","lat0":0,"long0":0.2792526803190927,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"3321","projName":"tmerc","lat0":0,"long0":0.3141592653589793,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"3322","projName":"tmerc","lat0":0,"long0":0.3490658503988659,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"3323","projName":"tmerc","lat0":0,"long0":0.3839724354387525,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"3324","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"3325","projName":"tmerc","lat0":0,"long0":0.4537856055185257,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"3326","projName":"tmerc","lat0":0,"long0":0.4886921905584123,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"3327","projName":"tmerc","lat0":0,"long0":0.5235987755982988,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"3328","projName":"sterea","lat0":0.9104800931237084,"long0":0.3345214399655799,"k0":0.999714,"x0":500000,"y0":500000,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"3329","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":5500000,"y0":0,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"3330","projName":"tmerc","lat0":0,"long0":0.3141592653589793,"k0":1,"x0":6500000,"y0":0,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"3331","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":7500000,"y0":0,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"3332","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":1,"x0":8500000,"y0":0,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"3333","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":3500000,"y0":0,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"3334","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":4500000,"y0":0,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"3335","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":5500000,"y0":0,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"3336","projName":"utm","zone":42,"utmSouth":true,"ellps":"intl","datum_params":[145,-187,103,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3337","projName":"lcc","lat1":-0.35247045447445774,"lat0":-0.35247045447445774,"long0":1.0039452864873555,"k0":1,"x0":1000000,"y0":1000000,"ellps":"clrk80","datum_params":[-770.1,158.4,-498.2,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3338","projName":"aea","lat1":0.9599310885968813,"lat2":1.1344640137963142,"lat0":0.8726646259971648,"long0":-2.6878070480712677,"x0":0,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3339","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"clrk80","datum_params":[-79.9,-158,-168.9,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3340","projName":"tmerc","lat0":0,"long0":0.24434609527920614,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"clrk80","datum_params":[-79.9,-158,-168.9,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3341","projName":"tmerc","lat0":0,"long0":0.2792526803190927,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"clrk80","datum_params":[-79.9,-158,-168.9,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3342","projName":"utm","zone":33,"utmSouth":true,"ellps":"clrk80","datum_params":[-79.9,-158,-168.9,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3343","projName":"utm","zone":28,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3344","projName":"utm","zone":29,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3345","projName":"utm","zone":30,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3346","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":0.9998,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3347","projName":"lcc","lat1":0.8552113334772214,"lat2":1.3439035240356338,"lat0":1.1063759938116564,"long0":-1.6033758061654573,"x0":6200000,"y0":3000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3348","projName":"lcc","lat1":0.8552113334772214,"lat2":1.3439035240356338,"lat0":1.1063759938116564,"long0":-1.6033758061654573,"x0":6200000,"y0":3000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3349","projName":"merc","long0":-2.6179938779914944,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3350","projName":"tmerc","lat0":0.0017453292519943296,"long0":0.3830997708127553,"k0":1,"x0":250000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"3351","projName":"tmerc","lat0":0.0017453292519943296,"long0":0.4354596483725852,"k0":1,"x0":1250000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"3352","projName":"tmerc","lat0":0.0017453292519943296,"long0":0.4878195259324151,"k0":1,"x0":2250000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"3353","projName":"utm","zone":32,"utmSouth":true,"ellps":"intl","units":"m","no_defs":true},{"EPSG":"3354","projName":"utm","zone":32,"utmSouth":true,"ellps":"intl","units":"m","no_defs":true},{"EPSG":"3355","projName":"tmerc","lat0":0.5235987755982988,"long0":0.5410520681182421,"k0":1,"x0":615000,"y0":810000,"ellps":"helmert","datum_params":[-146.21,112.63,4.05,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3356","projName":"utm","zone":17,"ellps":"clrk66","datum_params":[67.8,106.1,138.8,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3357","projName":"utm","zone":17,"ellps":"clrk66","datum_params":[42,124,147,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3358","projName":"lcc","lat1":0.6312274128046157,"lat2":0.5992297098513867,"lat0":0.5890486225480862,"long0":-1.3788101090755203,"x0":609601.22,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3359","projName":"lcc","lat1":0.6312274128046157,"lat2":0.5992297098513867,"lat0":0.5890486225480862,"long0":-1.3788101090755203,"x0":609601.2192024385,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"3360","projName":"lcc","lat1":0.6079563561113583,"lat2":0.5672320068981571,"lat0":0.5555964785515282,"long0":-1.413716694115407,"x0":609600,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3361","projName":"lcc","lat1":0.6079563561113583,"lat2":0.5672320068981571,"lat0":0.5555964785515282,"long0":-1.413716694115407,"x0":609600,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"3362","projName":"lcc","lat1":0.7321656212116213,"lat2":0.713548775857015,"lat0":0.7010405828843889,"long0":-1.3569934934255912,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3363","projName":"lcc","lat1":0.7321656212116213,"lat2":0.713548775857015,"lat0":0.7010405828843889,"long0":-1.3569934934255912,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3364","projName":"lcc","lat1":0.7150032169003437,"lat2":0.6969681479630688,"lat0":0.6864961724511032,"long0":-1.3569934934255912,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3365","projName":"lcc","lat1":0.7150032169003437,"lat2":0.6969681479630688,"lat0":0.6864961724511032,"long0":-1.3569934934255912,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3366","projName":"cass","lat0":0.38942018981064425,"long0":1.9927917296157087,"x0":40243.57775604237,"y0":19069.93351512578,"a":"6378293.645208759","b":"6356617.987679838","units":"m","no_defs":true},{"EPSG":"3367","projName":"utm","zone":28,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"3368","projName":"utm","zone":29,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"3369","projName":"utm","zone":30,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"3370","projName":"utm","zone":59,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"3371","projName":"utm","zone":60,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"3372","projName":"utm","zone":59,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3373","projName":"utm","zone":60,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3374","projName":"utm","zone":29,"ellps":"intl","units":"m","no_defs":true},{"EPSG":"3375","projName":"omerc","lat0":0.06981317007977318,"longc":1.784599160164202,"alpha":5.637863717220397,"k0":0.99984,"x0":804671,"y0":0,"no_uoff":true,"gamma":"323.1301023611111","ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"3376","projName":"omerc","lat0":0.06981317007977318,"longc":2.007128639793479,"alpha":0.9305364269950533,"k0":0.99984,"x0":0,"y0":0,"no_uoff":true,"gamma":"53.13010236111111","ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"3377","projName":"cass","lat0":0.03703029721342744,"long0":1.8051580258628899,"x0":-14810.562,"y0":8758.32,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"3378","projName":"cass","lat0":0.046815797933225635,"long0":1.7797978473856493,"x0":3673.785,"y0":-4240.573,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"3379","projName":"cass","lat0":0.0657882329365678,"long0":1.78666386692513,"x0":-7368.228,"y0":6485.858,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"3380","projName":"cass","lat0":0.06430925770298117,"long0":1.769573758757201,"x0":-34836.161,"y0":56464.049,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"3381","projName":"cass","lat0":0.08685256125826453,"long0":1.7989156705943061,"x0":19594.245,"y0":3371.895,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"3382","projName":"cass","lat0":0.0946233315567122,"long0":1.7513397638822126,"x0":-23.414,"y0":62.283,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"3383","projName":"cass","lat0":0.10410317766122681,"long0":1.756436023147793,"x0":0,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"3384","projName":"cass","lat0":0.08480664829968418,"long0":1.759560851477585,"x0":-1.769,"y0":133454.779,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"3385","projName":"cass","lat0":0.10424055155702394,"long0":1.7853887762551055,"x0":13227.851,"y0":8739.894,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"3386","projName":"tmerc","lat0":0,"long0":0.3141592653589793,"k0":1,"x0":500000,"y0":0,"ellps":"intl","datum_params":[-96.062,-82.428,-121.753,4.801,0.345,-1.376,1.496],"units":"m","no_defs":true},{"EPSG":"3387","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":5500000,"y0":0,"ellps":"intl","datum_params":[-96.062,-82.428,-121.753,4.801,0.345,-1.376,1.496],"units":"m","no_defs":true},{"EPSG":"3388","projName":"merc","long0":0.8901179185171081,"lat_ts":0.7330382858376184,"x0":0,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"3389","projName":"tmerc","lat0":0,"long0":3.141592653589793,"k0":1,"x0":60500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"3390","projName":"tmerc","lat0":0,"long0":3.141592653589793,"k0":1,"x0":60500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"3391","projName":"utm","zone":37,"ellps":"clrk80","datum_params":[70.995,-335.916,262.898,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3392","projName":"utm","zone":38,"ellps":"clrk80","datum_params":[70.995,-335.916,262.898,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3393","projName":"utm","zone":39,"ellps":"clrk80","datum_params":[70.995,-335.916,262.898,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3394","projName":"lcc","lat1":0.5672320068981571,"lat0":0.5672320068981571,"long0":0.7853981633974483,"k0":0.9987864078,"x0":1500000,"y0":1166200,"ellps":"clrk80","units":"m","no_defs":true},{"EPSG":"3395","projName":"merc","long0":0,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3396","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":1,"x0":3500000,"y0":0,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"3397","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":1,"x0":4500000,"y0":0,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"3398","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":1,"x0":4500000,"y0":0,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"3399","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":5500000,"y0":0,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"3400","projName":"tmerc","lat0":0,"long0":-2.007128639793479,"k0":0.9992,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3401","projName":"tmerc","lat0":0,"long0":-2.007128639793479,"k0":0.9992,"x0":0,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3402","projName":"tmerc","lat0":0,"long0":-2.007128639793479,"k0":0.9992,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3403","projName":"tmerc","lat0":0,"long0":-2.007128639793479,"k0":0.9992,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3404","projName":"lcc","lat1":0.6312274128046157,"lat2":0.5992297098513867,"lat0":0.5890486225480862,"long0":-1.3788101090755203,"x0":609601.2192024384,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3405","projName":"utm","zone":48,"ellps":"WGS84","datum_params":[-192.873,-39.382,-111.202,-0.00205,-0.0005,0.00335,0.0188],"units":"m","no_defs":true},{"EPSG":"3406","projName":"utm","zone":49,"ellps":"WGS84","datum_params":[-192.873,-39.382,-111.202,-0.00205,-0.0005,0.00335,0.0188],"units":"m","no_defs":true},{"EPSG":"3407","projName":"cass","lat0":0.38942018981064425,"long0":1.9927917296157087,"x0":40243.57775604237,"y0":19069.93351512578,"a":"6378293.645208759","b":"6356617.987679838","to_meter":0.3047972654,"no_defs":true},{"EPSG":"3408","projName":"laea","lat0":1.5707963267948966,"long0":0,"x0":0,"y0":0,"a":"6371228","b":"6371228","units":"m","no_defs":true},{"EPSG":"3409","projName":"laea","lat0":-1.5707963267948966,"long0":0,"x0":0,"y0":0,"a":"6371228","b":"6371228","units":"m","no_defs":true},{"EPSG":"3410","projName":"cea","long0":0,"lat_ts":0.5235987755982988,"x0":0,"y0":0,"a":"6371228","b":"6371228","units":"m","no_defs":true},{"EPSG":"3411","projName":"stere","lat0":1.5707963267948966,"lat_ts":1.2217304763960306,"long0":-0.7853981633974483,"k0":1,"x0":0,"y0":0,"a":"6378273","b":"6356889.449","units":"m","no_defs":true},{"EPSG":"3412","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.2217304763960306,"long0":0,"k0":1,"x0":0,"y0":0,"a":"6378273","b":"6356889.449","units":"m","no_defs":true},{"EPSG":"3413","projName":"stere","lat0":1.5707963267948966,"lat_ts":1.2217304763960306,"long0":-0.7853981633974483,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3414","projName":"tmerc","lat0":0.023852833110589174,"long0":1.812233539987445,"k0":1,"x0":28001.642,"y0":38744.572,"ellps":"WGS84","units":"m","no_defs":true},{"EPSG":"3415","projName":"lcc","lat1":0.3141592653589793,"lat2":0.4188790204786391,"lat0":0.3665191429188092,"long0":1.9896753472735358,"x0":500000,"y0":500000,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"3416","projName":"lcc","lat1":0.8552113334772214,"lat2":0.8028514559173916,"lat0":0.8290313946973066,"long0":0.23271056693257722,"x0":400000,"y0":400000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3417","projName":"lcc","lat1":0.7551457896962134,"lat2":0.7342018386722814,"lat0":0.7243116395776468,"long0":-1.631882850614698,"x0":1500000,"y0":999999.9999898402,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3418","projName":"lcc","lat1":0.729256739124964,"lat2":0.7088945645183635,"lat0":0.6981317007977318,"long0":-1.631882850614698,"x0":500000.00001016,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3419","projName":"lcc","lat1":0.6943501540850774,"lat2":0.6757333087304713,"lat0":0.6690428799311599,"long0":-1.710422666954443,"x0":399999.99998984,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3420","projName":"lcc","lat1":0.6731153148524798,"lat2":0.6504260345765536,"lat0":0.6399540590645874,"long0":-1.7191493132144147,"x0":399999.99998984,"y0":399999.99998984,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3421","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.017309727096779,"k0":0.9999,"x0":200000.00001016,"y0":8000000.000010163,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3422","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.0362174606600516,"k0":0.9999,"x0":500000.00001016,"y0":6000000,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3423","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.0696696046566085,"k0":0.9999,"x0":800000.0000101599,"y0":3999999.99998984,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3424","projName":"tmerc","lat0":0.6777695261911315,"long0":-1.3002702927357754,"k0":0.9999,"x0":150000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3425","projName":"lcc","lat1":0.7551457896962134,"lat2":0.7342018386722814,"lat0":0.7243116395776468,"long0":-1.631882850614698,"x0":1500000,"y0":999999.9999898402,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3426","projName":"lcc","lat1":0.729256739124964,"lat2":0.7088945645183635,"lat0":0.6981317007977318,"long0":-1.631882850614698,"x0":500000.00001016,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3427","projName":"lcc","lat1":0.6943501540850774,"lat2":0.6757333087304713,"lat0":0.6690428799311599,"long0":-1.710422666954443,"x0":399999.99998984,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3428","projName":"lcc","lat1":0.6731153148524798,"lat2":0.6504260345765536,"lat0":0.6399540590645874,"long0":-1.7191493132144147,"x0":399999.99998984,"y0":399999.99998984,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3429","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.017309727096779,"k0":0.9999,"x0":200000.00001016,"y0":8000000.000010163,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3430","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.0362174606600516,"k0":0.9999,"x0":500000.00001016,"y0":6000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3431","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.0696696046566085,"k0":0.9999,"x0":800000.0000101599,"y0":3999999.99998984,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3432","projName":"tmerc","lat0":0.6777695261911315,"long0":-1.3002702927357754,"k0":0.9999,"x0":150000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3433","projName":"lcc","lat1":0.6323909656392787,"lat2":0.6097016853633525,"lat0":0.5992297098513867,"long0":-1.6057029118347832,"x0":399999.99998984,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3434","projName":"lcc","lat1":0.6067928032766954,"lat2":0.5811946409141117,"lat0":0.5701408889848142,"long0":-1.6057029118347832,"x0":399999.99998984,"y0":399999.99998984,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3435","projName":"tmerc","lat0":0.6399540590645874,"long0":-1.5417075059283243,"k0":0.999975,"x0":300000.0000000001,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3436","projName":"tmerc","lat0":0.6399540590645874,"long0":-1.573705208881554,"k0":0.999941177,"x0":699999.9999898402,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3437","projName":"tmerc","lat0":0.7417649320975901,"long0":-1.2508192972626029,"k0":0.999966667,"x0":300000.0000000001,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3438","projName":"tmerc","lat0":0.7170394343610039,"long0":-1.2479104151759457,"k0":0.99999375,"x0":99999.99998983997,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3439","projName":"utm","zone":39,"ellps":"clrk80","datum_params":[-180.624,-225.516,173.919,-0.81,-1.898,8.336,16.7101],"units":"m","no_defs":true},{"EPSG":"3440","projName":"utm","zone":40,"ellps":"clrk80","datum_params":[-180.624,-225.516,173.919,-0.81,-1.898,8.336,16.7101],"units":"m","no_defs":true},{"EPSG":"3441","projName":"lcc","lat1":0.6323909656392787,"lat2":0.6097016853633525,"lat0":0.5992297098513867,"long0":-1.6057029118347832,"x0":399999.99998984,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3442","projName":"lcc","lat1":0.6067928032766954,"lat2":0.5811946409141117,"lat0":0.5701408889848142,"long0":-1.6057029118347832,"x0":399999.99998984,"y0":399999.99998984,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3443","projName":"tmerc","lat0":0.6399540590645874,"long0":-1.5417075059283243,"k0":0.999975,"x0":300000.0000000001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3444","projName":"tmerc","lat0":0.6399540590645874,"long0":-1.573705208881554,"k0":0.999941177,"x0":699999.9999898402,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3445","projName":"tmerc","lat0":0.7417649320975901,"long0":-1.2508192972626029,"k0":0.999966667,"x0":300000.0000000001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3446","projName":"tmerc","lat0":0.7170394343610039,"long0":-1.2479104151759457,"k0":0.99999375,"x0":99999.99998983997,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3447","projName":"lcc","lat1":0.8697557439105077,"lat2":0.8930268006037652,"lat0":0.8865891245689633,"long0":0.07608266909673504,"x0":150328,"y0":166262,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3448","projName":"lcc","lat1":0.3141592653589793,"lat0":0.3141592653589793,"long0":-1.3439035240356338,"k0":1,"x0":750000,"y0":650000,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3449","projName":"utm","zone":17,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3450","projName":"utm","zone":18,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3451","projName":"lcc","lat1":0.5701408889848142,"lat2":0.5439609502048994,"lat0":0.5323254218582705,"long0":-1.6144295580947547,"x0":999999.9999898402,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3452","projName":"lcc","lat1":0.5358160803622591,"lat2":0.5113814708343386,"lat0":0.49741883681838395,"long0":-1.5940673834881542,"x0":999999.9999898402,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3453","projName":"lcc","lat1":0.485783308471755,"lat2":0.456694487605183,"lat0":0.44505895925855404,"long0":-1.5940673834881542,"x0":999999.9999898402,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3454","projName":"lcc","lat1":0.7749261878854823,"lat2":0.7475826962709047,"lat0":0.738856050010933,"long0":-1.7511470161676435,"x0":600000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3455","projName":"lcc","lat1":0.7749261878854823,"lat2":0.7475826962709047,"lat0":0.738856050010933,"long0":-1.7511470161676435,"x0":600000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3456","projName":"lcc","lat1":0.5701408889848142,"lat2":0.5439609502048994,"lat0":0.5323254218582705,"long0":-1.6144295580947547,"x0":999999.9999898402,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3457","projName":"lcc","lat1":0.5358160803622591,"lat2":0.5113814708343386,"lat0":0.49741883681838395,"long0":-1.5940673834881542,"x0":999999.9999898402,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3458","projName":"lcc","lat1":0.7973245799527429,"lat2":0.7752170760941479,"lat0":0.765035988790848,"long0":-1.7453292519943295,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3459","projName":"lcc","lat1":0.7749261878854823,"lat2":0.7475826962709047,"lat0":0.738856050010933,"long0":-1.7511470161676435,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3460","projName":"tmerc","lat0":-0.29670597283903605,"long0":3.119776037939864,"k0":0.99985,"x0":2000000,"y0":4000000,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"3461","projName":"utm","zone":28,"a":"6378249.2","b":"6356515","datum_params":[-83,37,124,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3462","projName":"utm","zone":29,"a":"6378249.2","b":"6356515","datum_params":[-83,37,124,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3463","projName":"tmerc","lat0":0.7592182246175333,"long0":-1.2064588454410803,"k0":0.99998,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3464","projName":"tmerc","lat0":0.7592182246175333,"long0":-1.2064588454410803,"k0":0.99998,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3465","projName":"tmerc","lat0":0.5323254218582705,"long0":-1.498074274628466,"k0":0.99996,"x0":200000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3466","projName":"tmerc","lat0":0.5235987755982988,"long0":-1.5271630954950384,"k0":0.999933333,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3467","projName":"aea","lat1":0.9599310885968813,"lat2":1.1344640137963142,"lat0":0.8726646259971648,"long0":-2.6878070480712677,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3468","projName":"omerc","lat0":0.9948376736367679,"longc":-2.332923433499088,"alpha":5.639684198507691,"k0":0.9999,"x0":5000000,"y0":-5000000,"no_uoff":true,"gamma":"323.1301023611111","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3469","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.478367537831948,"k0":0.9999,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3470","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.548180707911721,"k0":0.9999,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3471","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.6179938779914944,"k0":0.9999,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3472","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.6878070480712677,"k0":0.9999,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3473","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.7576202181510405,"k0":0.9999,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3474","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.827433388230814,"k0":0.9999,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3475","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.897246558310587,"k0":0.9999,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3476","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.9670597283903604,"k0":0.9999,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3477","projName":"lcc","lat1":0.9395689139902809,"lat2":0.9046623289503943,"lat0":0.8901179185171081,"long0":-3.07177948351002,"x0":1000000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3478","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.953314321190321,"k0":0.9999,"x0":213360,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3479","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.953314321190321,"k0":0.9999,"x0":213360,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"3480","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.9227710592804204,"k0":0.9999,"x0":213360,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3481","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.9227710592804204,"k0":0.9999,"x0":213360,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"3482","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.9853120241435498,"k0":0.999933333,"x0":213360,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3483","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.9853120241435498,"k0":0.999933333,"x0":213360,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"3484","projName":"lcc","lat1":0.6323909656392787,"lat2":0.6097016853633525,"lat0":0.5992297098513867,"long0":-1.6057029118347832,"x0":400000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3485","projName":"lcc","lat1":0.6323909656392787,"lat2":0.6097016853633525,"lat0":0.5992297098513867,"long0":-1.6057029118347832,"x0":399999.99998984,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3486","projName":"lcc","lat1":0.6067928032766954,"lat2":0.5811946409141117,"lat0":0.5701408889848142,"long0":-1.6057029118347832,"x0":400000,"y0":400000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3487","projName":"lcc","lat1":0.6067928032766954,"lat2":0.5811946409141117,"lat0":0.5701408889848142,"long0":-1.6057029118347832,"x0":399999.99998984,"y0":399999.99998984,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3488","projName":"aea","lat1":0.5934119456780721,"lat2":0.7068583470577035,"lat0":0,"long0":-2.0943951023931953,"x0":0,"y0":-4000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3489","projName":"lcc","lat1":0.7272205216643038,"lat2":0.6981317007977318,"lat0":0.6864961724511032,"long0":-2.129301687433082,"x0":2000000,"y0":500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3490","projName":"lcc","lat1":0.7272205216643038,"lat2":0.6981317007977318,"lat0":0.6864961724511032,"long0":-2.129301687433082,"x0":2000000.0001016,"y0":500000.0001016001,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3491","projName":"lcc","lat1":0.6952228187110747,"lat2":0.6690428799311599,"lat0":0.6574073515845307,"long0":-2.129301687433082,"x0":2000000,"y0":500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3492","projName":"lcc","lat1":0.6952228187110747,"lat2":0.6690428799311599,"lat0":0.6574073515845307,"long0":-2.129301687433082,"x0":2000000.0001016,"y0":500000.0001016001,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3493","projName":"lcc","lat1":0.670788209183154,"lat2":0.6469353760725649,"lat0":0.6370451769779303,"long0":-2.1031217486531673,"x0":2000000,"y0":500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3494","projName":"lcc","lat1":0.670788209183154,"lat2":0.6469353760725649,"lat0":0.6370451769779303,"long0":-2.1031217486531673,"x0":2000000.0001016,"y0":500000.0001016001,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3495","projName":"lcc","lat1":0.6501351463678877,"lat2":0.6283185307179586,"lat0":0.6166830023713299,"long0":-2.076941809873252,"x0":2000000,"y0":500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3496","projName":"lcc","lat1":0.6501351463678877,"lat2":0.6283185307179586,"lat0":0.6166830023713299,"long0":-2.076941809873252,"x0":2000000.0001016,"y0":500000.0001016001,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3497","projName":"lcc","lat1":0.6190101080406556,"lat2":0.5939937220954035,"lat0":0.5846852994181004,"long0":-2.059488517353309,"x0":2000000,"y0":500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3498","projName":"lcc","lat1":0.6190101080406556,"lat2":0.5939937220954035,"lat0":0.5846852994181004,"long0":-2.059488517353309,"x0":2000000.0001016,"y0":500000.0001016001,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3499","projName":"lcc","lat1":0.591375728217412,"lat2":0.5721771064454744,"lat0":0.5614142427248425,"long0":-2.028945255443408,"x0":2000000,"y0":500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3500","projName":"lcc","lat1":0.591375728217412,"lat2":0.5721771064454744,"lat0":0.5614142427248425,"long0":-2.028945255443408,"x0":2000000.0001016,"y0":500000.0001016001,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3501","projName":"lcc","lat1":0.693768377667746,"lat2":0.6710790973918198,"lat0":0.6603162336711882,"long0":-1.8413223608540177,"x0":914401.8289,"y0":304800.6096,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3502","projName":"lcc","lat1":0.693768377667746,"lat2":0.6710790973918198,"lat0":0.6603162336711882,"long0":-1.8413223608540177,"x0":914401.8288036576,"y0":304800.6096012192,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3503","projName":"lcc","lat1":0.7118034466050207,"lat2":0.6931866012504145,"lat0":0.6864961724511032,"long0":-1.8413223608540177,"x0":914401.8289,"y0":304800.6096,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3504","projName":"lcc","lat1":0.7118034466050207,"lat2":0.6931866012504145,"lat0":0.6864961724511032,"long0":-1.8413223608540177,"x0":914401.8288036576,"y0":304800.6096012192,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3505","projName":"lcc","lat1":0.670788209183154,"lat2":0.649844258159222,"lat0":0.6399540590645874,"long0":-1.8413223608540177,"x0":914401.8289,"y0":304800.6096,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3506","projName":"lcc","lat1":0.670788209183154,"lat2":0.649844258159222,"lat0":0.6399540590645874,"long0":-1.8413223608540177,"x0":914401.8288036576,"y0":304800.6096012192,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3507","projName":"lcc","lat1":0.7307111801682926,"lat2":0.7190756518216638,"lat0":0.712676111231018,"long0":-1.2697270308258748,"x0":304800.6096,"y0":152400.3048,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3508","projName":"lcc","lat1":0.7307111801682926,"lat2":0.7190756518216638,"lat0":0.712676111231018,"long0":-1.2697270308258748,"x0":304800.6096012192,"y0":152400.3048006096,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3509","projName":"tmerc","lat0":0.6632251157578453,"long0":-1.3162691442123904,"k0":0.999995,"x0":200000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3510","projName":"tmerc","lat0":0.6632251157578453,"long0":-1.3162691442123904,"k0":0.999995,"x0":200000.0001016002,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3511","projName":"tmerc","lat0":0.42469678465195343,"long0":-1.413716694115407,"k0":0.999941177,"x0":200000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3512","projName":"tmerc","lat0":0.42469678465195343,"long0":-1.413716694115407,"k0":0.999941177,"x0":200000.0001016002,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3513","projName":"aea","lat1":0.4188790204786391,"lat2":0.5497787143782138,"lat0":0.4188790204786391,"long0":-1.4660765716752369,"x0":400000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3514","projName":"lcc","lat1":0.5366887449882564,"lat2":0.5163265703816557,"lat0":0.5061454830783556,"long0":-1.4748032179352084,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3515","projName":"lcc","lat1":0.5366887449882564,"lat2":0.5163265703816557,"lat0":0.5061454830783556,"long0":-1.4748032179352084,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3516","projName":"tmerc","lat0":0.42469678465195343,"long0":-1.4311699866353502,"k0":0.999941177,"x0":200000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3517","projName":"tmerc","lat0":0.42469678465195343,"long0":-1.4311699866353502,"k0":0.999941177,"x0":200000.0001016002,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3518","projName":"tmerc","lat0":0.5235987755982988,"long0":-1.4340788687220076,"k0":0.9999,"x0":200000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3519","projName":"tmerc","lat0":0.5235987755982988,"long0":-1.4340788687220076,"k0":0.9999,"x0":200000.0001016002,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3520","projName":"tmerc","lat0":0.5235987755982988,"long0":-1.468985453761894,"k0":0.9999,"x0":700000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3521","projName":"tmerc","lat0":0.5235987755982988,"long0":-1.468985453761894,"k0":0.9999,"x0":699999.9998983998,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3522","projName":"tmerc","lat0":0.7272205216643038,"long0":-1.9896753472735358,"k0":0.999947368,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3523","projName":"tmerc","lat0":0.7272205216643038,"long0":-1.9896753472735358,"k0":0.999947368,"x0":500000.0001016001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3524","projName":"tmerc","lat0":0.7272205216643038,"long0":-1.957677644320307,"k0":0.999947368,"x0":200000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3525","projName":"tmerc","lat0":0.7272205216643038,"long0":-1.957677644320307,"k0":0.999947368,"x0":200000.0001016002,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3526","projName":"tmerc","lat0":0.7272205216643038,"long0":-2.0202186091834364,"k0":0.999933333,"x0":800000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3527","projName":"tmerc","lat0":0.7272205216643038,"long0":-2.0202186091834364,"k0":0.999933333,"x0":800000.0001016001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3528","projName":"tmerc","lat0":0.6399540590645874,"long0":-1.5417075059283243,"k0":0.999975,"x0":300000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3529","projName":"tmerc","lat0":0.6399540590645874,"long0":-1.5417075059283243,"k0":0.999975,"x0":300000.0000000001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3530","projName":"tmerc","lat0":0.6399540590645874,"long0":-1.573705208881554,"k0":0.999941177,"x0":700000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3531","projName":"tmerc","lat0":0.6399540590645874,"long0":-1.573705208881554,"k0":0.999941177,"x0":699999.9999898402,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3532","projName":"tmerc","lat0":0.6544984694978736,"long0":-1.4951653925418091,"k0":0.999966667,"x0":100000,"y0":250000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3533","projName":"tmerc","lat0":0.6544984694978736,"long0":-1.4951653925418091,"k0":0.999966667,"x0":99999.99989839978,"y0":249999.9998983998,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3534","projName":"tmerc","lat0":0.6544984694978736,"long0":-1.5198908902783952,"k0":0.999966667,"x0":900000,"y0":250000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3535","projName":"tmerc","lat0":0.6544984694978736,"long0":-1.5198908902783952,"k0":0.999966667,"x0":900000,"y0":249999.9998983998,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3536","projName":"lcc","lat1":0.7551457896962134,"lat2":0.7342018386722814,"lat0":0.7243116395776468,"long0":-1.631882850614698,"x0":1500000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3537","projName":"lcc","lat1":0.7551457896962134,"lat2":0.7342018386722814,"lat0":0.7243116395776468,"long0":-1.631882850614698,"x0":1500000,"y0":999999.9999898402,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3538","projName":"lcc","lat1":0.729256739124964,"lat2":0.7088945645183635,"lat0":0.6981317007977318,"long0":-1.631882850614698,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3539","projName":"lcc","lat1":0.729256739124964,"lat2":0.7088945645183635,"lat0":0.6981317007977318,"long0":-1.631882850614698,"x0":500000.00001016,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3540","projName":"lcc","lat1":0.6943501540850774,"lat2":0.6757333087304713,"lat0":0.6690428799311599,"long0":-1.710422666954443,"x0":400000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3541","projName":"lcc","lat1":0.6943501540850774,"lat2":0.6757333087304713,"lat0":0.6690428799311599,"long0":-1.710422666954443,"x0":399999.99998984,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3542","projName":"lcc","lat1":0.6731153148524798,"lat2":0.6504260345765536,"lat0":0.6399540590645874,"long0":-1.7191493132144147,"x0":400000,"y0":400000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3543","projName":"lcc","lat1":0.6731153148524798,"lat2":0.6504260345765536,"lat0":0.6399540590645874,"long0":-1.7191493132144147,"x0":399999.99998984,"y0":399999.99998984,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3544","projName":"lcc","lat1":0.6626433393405138,"lat2":0.6800966318604571,"lat0":0.6544984694978736,"long0":-1.4704398948052226,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3545","projName":"lcc","lat1":0.6626433393405138,"lat2":0.6800966318604571,"lat0":0.6544984694978736,"long0":-1.4704398948052226,"x0":500000.0001016001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3546","projName":"lcc","lat1":0.6472262642812308,"lat2":0.6748606441044739,"lat0":0.6341362948912732,"long0":-1.4966198335851375,"x0":1500000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3547","projName":"lcc","lat1":0.6472262642812308,"lat2":0.6748606441044739,"lat0":0.6341362948912732,"long0":-1.4966198335851375,"x0":1500000,"y0":999999.9998983998,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3548","projName":"lcc","lat1":0.6620615629231823,"lat2":0.6411176118992503,"lat0":0.6341362948912732,"long0":-1.4966198335851375,"x0":500000,"y0":500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3549","projName":"lcc","lat1":0.6620615629231823,"lat2":0.6411176118992503,"lat0":0.6341362948912732,"long0":-1.4966198335851375,"x0":500000.0001016001,"y0":500000.0001016001,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3550","projName":"lcc","lat1":0.5701408889848142,"lat2":0.5439609502048994,"lat0":0.5323254218582705,"long0":-1.6144295580947547,"x0":1000000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3551","projName":"lcc","lat1":0.5701408889848142,"lat2":0.5439609502048994,"lat0":0.5323254218582705,"long0":-1.6144295580947547,"x0":999999.9999898402,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3552","projName":"lcc","lat1":0.5358160803622591,"lat2":0.5113814708343386,"lat0":0.49741883681838395,"long0":-1.5940673834881542,"x0":1000000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3553","projName":"lcc","lat1":0.5358160803622591,"lat2":0.5113814708343386,"lat0":0.49741883681838395,"long0":-1.5940673834881542,"x0":999999.9999898402,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3554","projName":"tmerc","lat0":0.7592182246175333,"long0":-1.2064588454410803,"k0":0.99998,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3555","projName":"tmerc","lat0":0.765035988790848,"long0":-1.1846422297911512,"k0":0.99998,"x0":700000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3556","projName":"tmerc","lat0":0.7475826962709047,"long0":-1.2282754610910094,"k0":0.99998,"x0":300000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3557","projName":"tmerc","lat0":0.7621271067041904,"long0":-1.1955505376161157,"k0":0.9999,"x0":300000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3558","projName":"tmerc","lat0":0.7475826962709047,"long0":-1.224639358482688,"k0":0.999966667,"x0":900000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3559","projName":"lcc","lat1":0.688532389911763,"lat2":0.6684611035138281,"lat0":0.6574073515845307,"long0":-1.3439035240356338,"x0":400000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3560","projName":"lcc","lat1":0.729256739124964,"lat2":0.7106398937703579,"lat0":0.7039494649710464,"long0":-1.9460421159736774,"x0":500000.00001016,"y0":999999.9999898402,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3561","projName":"tmerc","lat0":0.32870367579226534,"long0":-2.7139869868511823,"k0":0.999966667,"x0":152400.3048006096,"y0":0,"ellps":"clrk66","datum_params":[61,-285,-181,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3562","projName":"tmerc","lat0":0.35488361457218026,"long0":-2.734349161457784,"k0":0.999966667,"x0":152400.3048006096,"y0":0,"ellps":"clrk66","datum_params":[61,-285,-181,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3563","projName":"tmerc","lat0":0.3694280250054665,"long0":-2.7576202181510405,"k0":0.99999,"x0":152400.3048006096,"y0":0,"ellps":"clrk66","datum_params":[61,-285,-181,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3564","projName":"tmerc","lat0":0.3810635533520952,"long0":-2.7838001569309556,"k0":0.99999,"x0":152400.3048006096,"y0":0,"ellps":"clrk66","datum_params":[61,-285,-181,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3565","projName":"tmerc","lat0":0.37815467126543817,"long0":-2.7954356852775852,"k0":1,"x0":152400.3048006096,"y0":0,"ellps":"clrk66","datum_params":[61,-285,-181,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3566","projName":"lcc","lat1":0.7094763409356949,"lat2":0.6809692964864543,"lat0":0.6690428799311599,"long0":-1.9460421159736774,"x0":500000.00001016,"y0":2000000.00001016,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3567","projName":"lcc","lat1":0.6693337681398254,"lat2":0.6495533699505563,"lat0":0.6399540590645874,"long0":-1.9460421159736774,"x0":500000.00001016,"y0":3000000,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3568","projName":"lcc","lat1":0.729256739124964,"lat2":0.7106398937703579,"lat0":0.7039494649710464,"long0":-1.9460421159736774,"x0":500000.00001016,"y0":999999.9999898402,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3569","projName":"lcc","lat1":0.7094763409356949,"lat2":0.6809692964864543,"lat0":0.6690428799311599,"long0":-1.9460421159736774,"x0":500000.00001016,"y0":2000000.00001016,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3570","projName":"lcc","lat1":0.6693337681398254,"lat2":0.6495533699505563,"lat0":0.6399540590645874,"long0":-1.9460421159736774,"x0":500000.00001016,"y0":3000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3571","projName":"laea","lat0":1.5707963267948966,"long0":3.141592653589793,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3572","projName":"laea","lat0":1.5707963267948966,"long0":-2.6179938779914944,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3573","projName":"laea","lat0":1.5707963267948966,"long0":-1.7453292519943295,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3574","projName":"laea","lat0":1.5707963267948966,"long0":-0.6981317007977318,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3575","projName":"laea","lat0":1.5707963267948966,"long0":0.17453292519943295,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3576","projName":"laea","lat0":1.5707963267948966,"long0":1.5707963267948966,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3577","projName":"aea","lat1":-0.3141592653589793,"lat2":-0.6283185307179586,"lat0":0,"long0":2.303834612632515,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3578","projName":"aea","lat1":1.0762863720631697,"lat2":1.1868238913561442,"lat0":1.0297442586766545,"long0":-2.3125612588924866,"x0":500000,"y0":500000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3579","projName":"aea","lat1":1.0762863720631697,"lat2":1.1868238913561442,"lat0":1.0297442586766545,"long0":-2.3125612588924866,"x0":500000,"y0":500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3580","projName":"lcc","lat1":1.0821041362364843,"lat2":1.2217304763960306,"lat0":0,"long0":-1.9547687622336491,"x0":0,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3581","projName":"lcc","lat1":1.0821041362364843,"lat2":1.2217304763960306,"lat0":0,"long0":-1.9547687622336491,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3582","projName":"lcc","lat1":0.688532389911763,"lat2":0.6684611035138281,"lat0":0.6574073515845307,"long0":-1.3439035240356338,"x0":399999.9998983998,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3583","projName":"lcc","lat1":0.7240207513689809,"lat2":0.7205300928649924,"lat0":0.7155849933176751,"long0":-1.2304571226560024,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3584","projName":"lcc","lat1":0.7240207513689809,"lat2":0.7205300928649924,"lat0":0.7155849933176751,"long0":-1.2304571226560024,"x0":500000.0001016001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3585","projName":"lcc","lat1":0.7449647023929129,"lat2":0.7280931862903012,"lat0":0.7155849933176751,"long0":-1.2479104151759457,"x0":200000,"y0":750000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3586","projName":"lcc","lat1":0.7449647023929129,"lat2":0.7280931862903012,"lat0":0.7155849933176751,"long0":-1.2479104151759457,"x0":200000.0001016002,"y0":750000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3587","projName":"lcc","lat1":0.7976154681614086,"lat2":0.7711446411728279,"lat0":0.7560184543222105,"long0":-1.4724761122658825,"x0":6000000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3588","projName":"lcc","lat1":0.7976154681614086,"lat2":0.7711446411728279,"lat0":0.7560184543222105,"long0":-1.4724761122658825,"x0":5999999.999976001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"3589","projName":"lcc","lat1":0.8217591894806636,"lat2":0.7938339214487541,"lat0":0.7816166166847939,"long0":-1.5184364492350666,"x0":8000000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3590","projName":"lcc","lat1":0.8217591894806636,"lat2":0.7938339214487541,"lat0":0.7816166166847939,"long0":-1.5184364492350666,"x0":7999999.999968001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"3591","projName":"omerc","lat0":0.7907941396681973,"longc":-1.5009831567151235,"alpha":5.886219942657287,"k0":0.9996,"x0":2546731.496,"y0":-4354009.816,"no_uoff":true,"gamma":"337.25556","ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3592","projName":"lcc","lat1":0.7621271067041904,"lat2":0.7347836150896128,"lat0":0.7243116395776468,"long0":-1.4724761122658825,"x0":4000000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3593","projName":"lcc","lat1":0.7621271067041904,"lat2":0.7347836150896128,"lat0":0.7243116395776468,"long0":-1.4724761122658825,"x0":3999999.999984,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"3594","projName":"lcc","lat1":0.821177413063332,"lat2":0.79616102711808,"lat0":0.7853981633974483,"long0":-1.6449728200046556,"x0":800000,"y0":100000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3595","projName":"lcc","lat1":0.8488117928865756,"lat2":0.8208865248546663,"lat0":0.8115781021773633,"long0":-1.6249015336067207,"x0":800000,"y0":100000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3596","projName":"lcc","lat1":0.7891797101101027,"lat2":0.7641633241648506,"lat0":0.7504915783575618,"long0":-1.6406094968746698,"x0":800000,"y0":100000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3597","projName":"tmerc","lat0":0.5148721293383273,"long0":-1.550434152188296,"k0":0.99995,"x0":300000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3598","projName":"tmerc","lat0":0.5148721293383273,"long0":-1.550434152188296,"k0":0.99995,"x0":300000.0000000001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3599","projName":"tmerc","lat0":0.5148721293383273,"long0":-1.576614090968211,"k0":0.99995,"x0":700000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3600","projName":"tmerc","lat0":0.5148721293383273,"long0":-1.576614090968211,"k0":0.99995,"x0":699999.9998983998,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3601","projName":"tmerc","lat0":0.6254096486313016,"long0":-1.6144295580947547,"k0":0.999933333,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3602","projName":"tmerc","lat0":0.6254096486313016,"long0":-1.5795229730548683,"k0":0.999933333,"x0":250000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3603","projName":"tmerc","lat0":0.6312274128046157,"long0":-1.6493361431346414,"k0":0.999941177,"x0":850000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3604","projName":"lcc","lat1":0.8552113334772214,"lat2":0.7853981633974483,"lat0":0.7723081940074908,"long0":-1.911135530933791,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3605","projName":"lcc","lat1":0.8552113334772214,"lat2":0.7853981633974483,"lat0":0.7723081940074908,"long0":-1.911135530933791,"x0":599999.9999976,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"3606","projName":"lcc","lat1":0.7504915783575618,"lat2":0.6981317007977318,"lat0":0.6952228187110747,"long0":-1.7453292519943295,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3607","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.0362174606600516,"k0":0.9999,"x0":500000,"y0":6000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3608","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.0362174606600516,"k0":0.9999,"x0":500000.00001016,"y0":6000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3609","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.017309727096779,"k0":0.9999,"x0":200000,"y0":8000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3610","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.017309727096779,"k0":0.9999,"x0":200000.00001016,"y0":8000000.000010163,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3611","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.0696696046566085,"k0":0.9999,"x0":800000,"y0":4000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3612","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.0696696046566085,"k0":0.9999,"x0":800000.0000101599,"y0":3999999.99998984,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3613","projName":"tmerc","lat0":0.7417649320975901,"long0":-1.2508192972626029,"k0":0.999966667,"x0":300000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3614","projName":"tmerc","lat0":0.7417649320975901,"long0":-1.2508192972626029,"k0":0.999966667,"x0":300000.0000000001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3615","projName":"tmerc","lat0":0.6777695261911315,"long0":-1.3002702927357754,"k0":0.9999,"x0":150000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3616","projName":"tmerc","lat0":0.6777695261911315,"long0":-1.3002702927357754,"k0":0.9999,"x0":150000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3617","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.8544123302439752,"k0":0.9999,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3618","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.8544123302439752,"k0":0.9999,"x0":500000.0001016001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3619","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.8209601862474165,"k0":0.999909091,"x0":165000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3620","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.8209601862474165,"k0":0.999909091,"x0":165000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3621","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.882046710067218,"k0":0.999916667,"x0":830000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3622","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.882046710067218,"k0":0.999916667,"x0":830000.0001016001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3623","projName":"tmerc","lat0":0.6981317007977318,"long0":-1.3366313188189907,"k0":0.9999375,"x0":250000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3624","projName":"tmerc","lat0":0.6981317007977318,"long0":-1.3366313188189907,"k0":0.9999375,"x0":249999.9998983998,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3625","projName":"tmerc","lat0":0.6777695261911315,"long0":-1.3002702927357754,"k0":0.9999,"x0":150000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3626","projName":"tmerc","lat0":0.6777695261911315,"long0":-1.3002702927357754,"k0":0.9999,"x0":150000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3627","projName":"lcc","lat1":0.7161667697350065,"lat2":0.7097672291443605,"lat0":0.7010405828843889,"long0":-1.2915436464758039,"x0":300000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3628","projName":"lcc","lat1":0.7161667697350065,"lat2":0.7097672291443605,"lat0":0.7010405828843889,"long0":-1.2915436464758039,"x0":300000.0000000001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3629","projName":"tmerc","lat0":0.6981317007977318,"long0":-1.3715379038588773,"k0":0.9999375,"x0":350000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3630","projName":"tmerc","lat0":0.6981317007977318,"long0":-1.3715379038588773,"k0":0.9999375,"x0":350000.0001016001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3631","projName":"lcc","lat1":0.6312274128046157,"lat2":0.5992297098513867,"lat0":0.5890486225480862,"long0":-1.3788101090755203,"x0":609601.22,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3632","projName":"lcc","lat1":0.6312274128046157,"lat2":0.5992297098513867,"lat0":0.5890486225480862,"long0":-1.3788101090755203,"x0":609601.2192024384,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3633","projName":"lcc","lat1":0.8505571221385698,"lat2":0.8278678418626436,"lat0":0.8203047484373349,"long0":-1.7540558982543013,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3634","projName":"lcc","lat1":0.8505571221385698,"lat2":0.8278678418626436,"lat0":0.8203047484373349,"long0":-1.7540558982543013,"x0":599999.9999976,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"3635","projName":"lcc","lat1":0.8287405064886407,"lat2":0.8060512262127145,"lat0":0.797033691744077,"long0":-1.7540558982543013,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3636","projName":"lcc","lat1":0.8287405064886407,"lat2":0.8060512262127145,"lat0":0.797033691744077,"long0":-1.7540558982543013,"x0":599999.9999976,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"3637","projName":"lcc","lat1":0.7278022980816354,"lat2":0.7056947942230405,"lat0":0.6923139366244172,"long0":-1.4398966328953218,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3638","projName":"lcc","lat1":0.6987134772150633,"lat2":0.6760241969391368,"lat0":0.6632251157578453,"long0":-1.4398966328953218,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3639","projName":"lcc","lat1":0.6416993883165819,"lat2":0.6207554372926499,"lat0":0.6108652381980153,"long0":-1.710422666954443,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3640","projName":"lcc","lat1":0.6416993883165819,"lat2":0.6207554372926499,"lat0":0.6108652381980153,"long0":-1.710422666954443,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3641","projName":"lcc","lat1":0.6149376731193353,"lat2":0.5922483928434091,"lat0":0.5817764173314434,"long0":-1.710422666954443,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3642","projName":"lcc","lat1":0.6149376731193353,"lat2":0.5922483928434091,"lat0":0.5817764173314434,"long0":-1.710422666954443,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3643","projName":"lcc","lat1":0.7504915783575618,"lat2":0.7941248096574199,"lat0":0.7286749627076325,"long0":-2.1031217486531673,"x0":400000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3644","projName":"lcc","lat1":0.7504915783575618,"lat2":0.7941248096574199,"lat0":0.7286749627076325,"long0":-2.1031217486531673,"x0":399999.9999984,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"3645","projName":"lcc","lat1":0.8028514559173916,"lat2":0.7737626350508195,"lat0":0.7621271067041904,"long0":-2.1031217486531673,"x0":2500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3646","projName":"lcc","lat1":0.8028514559173916,"lat2":0.7737626350508195,"lat0":0.7621271067041904,"long0":-2.1031217486531673,"x0":2500000.0001424,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"3647","projName":"lcc","lat1":0.767944870877505,"lat2":0.738856050010933,"lat0":0.7272205216643038,"long0":-2.1031217486531673,"x0":1500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3648","projName":"lcc","lat1":0.767944870877505,"lat2":0.738856050010933,"lat0":0.7272205216643038,"long0":-2.1031217486531673,"x0":1500000.0001464,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"3649","projName":"lcc","lat1":0.7321656212116213,"lat2":0.713548775857015,"lat0":0.7010405828843889,"long0":-1.3569934934255912,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3650","projName":"lcc","lat1":0.7321656212116213,"lat2":0.713548775857015,"lat0":0.7010405828843889,"long0":-1.3569934934255912,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3651","projName":"lcc","lat1":0.7150032169003437,"lat2":0.6969681479630688,"lat0":0.6864961724511032,"long0":-1.3569934934255912,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3652","projName":"lcc","lat1":0.7150032169003437,"lat2":0.6969681479630688,"lat0":0.6864961724511032,"long0":-1.3569934934255912,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3653","projName":"tmerc","lat0":0.7170394343610039,"long0":-1.2479104151759457,"k0":0.99999375,"x0":100000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3654","projName":"tmerc","lat0":0.7170394343610039,"long0":-1.2479104151759457,"k0":0.99999375,"x0":99999.99998983997,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3655","projName":"lcc","lat1":0.6079563561113583,"lat2":0.5672320068981571,"lat0":0.5555964785515282,"long0":-1.413716694115407,"x0":609600,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3656","projName":"lcc","lat1":0.6079563561113583,"lat2":0.5672320068981571,"lat0":0.5555964785515282,"long0":-1.413716694115407,"x0":609600,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"3657","projName":"lcc","lat1":0.7973245799527429,"lat2":0.7752170760941479,"lat0":0.765035988790848,"long0":-1.7453292519943295,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3658","projName":"lcc","lat1":0.7973245799527429,"lat2":0.7752170760941479,"lat0":0.765035988790848,"long0":-1.7453292519943295,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3659","projName":"lcc","lat1":0.7749261878854823,"lat2":0.7475826962709047,"lat0":0.738856050010933,"long0":-1.7511470161676435,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3660","projName":"lcc","lat1":0.7749261878854823,"lat2":0.7475826962709047,"lat0":0.738856050010933,"long0":-1.7511470161676435,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3661","projName":"lcc","lat1":0.6355907359346015,"lat2":0.6152285613280012,"lat0":0.5992297098513867,"long0":-1.5009831567151235,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3662","projName":"lcc","lat1":0.6355907359346015,"lat2":0.6152285613280012,"lat0":0.5992297098513867,"long0":-1.5009831567151235,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3663","projName":"lcc","lat1":0.5564691431775254,"lat2":0.525634993058959,"lat0":0.5177810114249846,"long0":-1.7511470161676435,"x0":700000,"y0":3000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3664","projName":"lcc","lat1":0.5564691431775254,"lat2":0.525634993058959,"lat0":0.5177810114249846,"long0":-1.7511470161676435,"x0":699999.9998983998,"y0":3000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3665","projName":"aea","lat1":0.4799655442984406,"lat2":0.6108652381980153,"lat0":0.3141592653589793,"long0":-1.7453292519943295,"x0":1500000,"y0":6000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3666","projName":"lcc","lat1":0.4799655442984406,"lat2":0.6108652381980153,"lat0":0.3141592653589793,"long0":-1.7453292519943295,"x0":1500000,"y0":5000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3667","projName":"lcc","lat1":0.6315183010132815,"lat2":0.6047565858160352,"lat0":0.5934119456780721,"long0":-1.7715091907742444,"x0":200000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3668","projName":"lcc","lat1":0.6315183010132815,"lat2":0.6047565858160352,"lat0":0.5934119456780721,"long0":-1.7715091907742444,"x0":200000.0001016002,"y0":999999.9998983998,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3669","projName":"lcc","lat1":0.5928301692607406,"lat2":0.5608324663075113,"lat0":0.5526875964648711,"long0":-1.7191493132144147,"x0":600000,"y0":2000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3670","projName":"lcc","lat1":0.5928301692607406,"lat2":0.5608324663075113,"lat0":0.5526875964648711,"long0":-1.7191493132144147,"x0":600000,"y0":2000000.0001016,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3671","projName":"lcc","lat1":0.485783308471755,"lat2":0.456694487605183,"lat0":0.44796784134521134,"long0":-1.7191493132144147,"x0":300000,"y0":5000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3672","projName":"lcc","lat1":0.485783308471755,"lat2":0.456694487605183,"lat0":0.44796784134521134,"long0":-1.7191493132144147,"x0":300000.0000000001,"y0":5000000.0001016,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3673","projName":"lcc","lat1":0.5285438751456161,"lat2":0.4953826193577238,"lat0":0.485783308471755,"long0":-1.7278759594743862,"x0":600000,"y0":4000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3674","projName":"lcc","lat1":0.5285438751456161,"lat2":0.4953826193577238,"lat0":0.485783308471755,"long0":-1.7278759594743862,"x0":600000,"y0":3999999.9998984,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3675","projName":"lcc","lat1":0.7094763409356949,"lat2":0.6809692964864543,"lat0":0.6690428799311599,"long0":-1.9460421159736774,"x0":500000,"y0":2000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3676","projName":"lcc","lat1":0.7094763409356949,"lat2":0.6809692964864543,"lat0":0.6690428799311599,"long0":-1.9460421159736774,"x0":500000.0001504,"y0":1999999.999992,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"3677","projName":"lcc","lat1":0.7094763409356949,"lat2":0.6809692964864543,"lat0":0.6690428799311599,"long0":-1.9460421159736774,"x0":500000.00001016,"y0":2000000.00001016,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3678","projName":"lcc","lat1":0.729256739124964,"lat2":0.7106398937703579,"lat0":0.7039494649710464,"long0":-1.9460421159736774,"x0":500000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3679","projName":"lcc","lat1":0.729256739124964,"lat2":0.7106398937703579,"lat0":0.7039494649710464,"long0":-1.9460421159736774,"x0":500000.0001504,"y0":999999.9999960001,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"3680","projName":"lcc","lat1":0.729256739124964,"lat2":0.7106398937703579,"lat0":0.7039494649710464,"long0":-1.9460421159736774,"x0":500000.00001016,"y0":999999.9999898402,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3681","projName":"lcc","lat1":0.6693337681398254,"lat2":0.6495533699505563,"lat0":0.6399540590645874,"long0":-1.9460421159736774,"x0":500000,"y0":3000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3682","projName":"lcc","lat1":0.6693337681398254,"lat2":0.6495533699505563,"lat0":0.6399540590645874,"long0":-1.9460421159736774,"x0":500000.0001504,"y0":2999999.999988,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"ft","no_defs":true},{"EPSG":"3683","projName":"lcc","lat1":0.6693337681398254,"lat2":0.6495533699505563,"lat0":0.6399540590645874,"long0":-1.9460421159736774,"x0":500000.00001016,"y0":3000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3684","projName":"tmerc","lat0":0.7417649320975901,"long0":-1.265363707695889,"k0":0.999964286,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3685","projName":"lcc","lat1":0.6841690667817772,"lat2":0.6638068921751766,"lat0":0.6574073515845307,"long0":-1.3700834628155487,"x0":3500000,"y0":2000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3686","projName":"lcc","lat1":0.6841690667817772,"lat2":0.6638068921751766,"lat0":0.6574073515845307,"long0":-1.3700834628155487,"x0":3500000.0001016,"y0":2000000.0001016,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3687","projName":"lcc","lat1":0.6626433393405138,"lat2":0.6416993883165819,"lat0":0.6341362948912732,"long0":-1.3700834628155487,"x0":3500000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3688","projName":"lcc","lat1":0.6626433393405138,"lat2":0.6416993883165819,"lat0":0.6341362948912732,"long0":-1.3700834628155487,"x0":3500000.0001016,"y0":999999.9998983998,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3689","projName":"lcc","lat1":0.8505571221385698,"lat2":0.8290313946973066,"lat0":0.8203047484373349,"long0":-2.108939512826481,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3690","projName":"lcc","lat1":0.8505571221385698,"lat2":0.8290313946973066,"lat0":0.8203047484373349,"long0":-2.108939512826481,"x0":500000.0001016001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3691","projName":"lcc","lat1":0.8261225126106495,"lat2":0.7999425738307345,"lat0":0.7912159275707629,"long0":-2.1031217486531673,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3692","projName":"lcc","lat1":0.8261225126106495,"lat2":0.7999425738307345,"lat0":0.7912159275707629,"long0":-2.1031217486531673,"x0":500000.0001016001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3693","projName":"lcc","lat1":0.7024950239277177,"lat2":0.6806784082777885,"lat0":0.6719517620178169,"long0":-1.387536755335492,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3694","projName":"lcc","lat1":0.6786421908171285,"lat2":0.6542075812892078,"lat0":0.6457718232379019,"long0":-1.413716694115407,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3695","projName":"lcc","lat1":0.7941248096574199,"lat2":0.7723081940074908,"lat0":0.765035988790848,"long0":-1.5707963267948966,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3696","projName":"lcc","lat1":0.7941248096574199,"lat2":0.7723081940074908,"lat0":0.765035988790848,"long0":-1.5707963267948966,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3697","projName":"lcc","lat1":0.8162323135160149,"lat2":0.7952883624920829,"lat0":0.7883070454841054,"long0":-1.5707963267948966,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3698","projName":"lcc","lat1":0.8162323135160149,"lat2":0.7952883624920829,"lat0":0.7883070454841054,"long0":-1.5707963267948966,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3699","projName":"lcc","lat1":0.7691084237121679,"lat2":0.74583736701891,"lat0":0.7330382858376184,"long0":-1.5707963267948966,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3700","projName":"lcc","lat1":0.7691084237121679,"lat2":0.74583736701891,"lat0":0.7330382858376184,"long0":-1.5707963267948966,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3701","projName":"tmerc","lat0":0,"long0":-1.5707963267948966,"k0":0.9996,"x0":520000,"y0":-4480000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3702","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.8355045966807038,"k0":0.9999375,"x0":200000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3703","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.8733200638072465,"k0":0.9999375,"x0":400000,"y0":100000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3704","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.8980455615438334,"k0":0.9999375,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3705","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.9213166182370904,"k0":0.9999375,"x0":800000,"y0":100000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3706","projName":"utm","zone":59,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3707","projName":"utm","zone":60,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3708","projName":"utm","zone":1,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3709","projName":"utm","zone":2,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3710","projName":"utm","zone":3,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3711","projName":"utm","zone":4,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3712","projName":"utm","zone":5,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3713","projName":"utm","zone":6,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3714","projName":"utm","zone":7,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3715","projName":"utm","zone":8,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3716","projName":"utm","zone":9,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3717","projName":"utm","zone":10,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3718","projName":"utm","zone":11,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3719","projName":"utm","zone":12,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3720","projName":"utm","zone":13,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3721","projName":"utm","zone":14,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3722","projName":"utm","zone":15,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3723","projName":"utm","zone":16,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3724","projName":"utm","zone":17,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3725","projName":"utm","zone":18,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3726","projName":"utm","zone":19,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3727","projName":"tmerc","lat0":-0.36855536037946934,"long0":0.9692395112741843,"k0":1,"x0":160000,"y0":50000,"ellps":"intl","datum_params":[94,-948,-1262,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3728","projName":"lcc","lat1":0.7278022980816354,"lat2":0.7056947942230405,"lat0":0.6923139366244172,"long0":-1.4398966328953218,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3729","projName":"lcc","lat1":0.6987134772150633,"lat2":0.6760241969391368,"lat0":0.6632251157578453,"long0":-1.4398966328953218,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3730","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.8355045966807038,"k0":0.9999375,"x0":200000.00001016,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3731","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.8733200638072465,"k0":0.9999375,"x0":399999.99998984,"y0":99999.99998983997,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3732","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.8980455615438334,"k0":0.9999375,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3733","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.9213166182370904,"k0":0.9999375,"x0":800000.0000101599,"y0":99999.99998983997,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3734","projName":"lcc","lat1":0.7278022980816354,"lat2":0.7056947942230405,"lat0":0.6923139366244172,"long0":-1.4398966328953218,"x0":600000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3735","projName":"lcc","lat1":0.6987134772150633,"lat2":0.6760241969391368,"lat0":0.6632251157578453,"long0":-1.4398966328953218,"x0":600000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3736","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.8355045966807038,"k0":0.9999375,"x0":200000.00001016,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3737","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.8733200638072465,"k0":0.9999375,"x0":399999.99998984,"y0":99999.99998983997,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3738","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.8980455615438334,"k0":0.9999375,"x0":600000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3739","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.9213166182370904,"k0":0.9999375,"x0":800000.0000101599,"y0":99999.99998983997,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3740","projName":"utm","zone":10,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3741","projName":"utm","zone":11,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3742","projName":"utm","zone":12,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3743","projName":"utm","zone":13,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3744","projName":"utm","zone":14,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3745","projName":"utm","zone":15,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3746","projName":"utm","zone":16,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3747","projName":"utm","zone":17,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3748","projName":"utm","zone":18,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3749","projName":"utm","zone":19,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3750","projName":"utm","zone":4,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3751","projName":"utm","zone":5,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3752","projName":"merc","long0":1.7453292519943295,"lat_ts":-0.7155849933176751,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3753","projName":"lcc","lat1":0.7278022980816354,"lat2":0.7056947942230405,"lat0":0.6923139366244172,"long0":-1.4398966328953218,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3754","projName":"lcc","lat1":0.6987134772150633,"lat2":0.6760241969391368,"lat0":0.6632251157578453,"long0":-1.4398966328953218,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3755","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.8355045966807038,"k0":0.9999375,"x0":200000.00001016,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3756","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.8733200638072465,"k0":0.9999375,"x0":399999.99998984,"y0":99999.99998983997,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3757","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.8980455615438334,"k0":0.9999375,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3758","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.9213166182370904,"k0":0.9999375,"x0":800000.0000101599,"y0":99999.99998983997,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3759","projName":"tmerc","lat0":0.3694280250054665,"long0":-2.7576202181510405,"k0":0.99999,"x0":500000.00001016,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"3760","projName":"tmerc","lat0":0.3694280250054665,"long0":-2.7576202181510405,"k0":0.99999,"x0":500000.00001016,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3761","projName":"utm","zone":22,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3762","projName":"lcc","lat1":-0.9424777960769379,"lat2":-0.9555677654668955,"lat0":-0.9599310885968813,"long0":-0.6457718232379019,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3763","projName":"tmerc","lat0":0.6923417164483449,"long0":-0.14194951883805518,"k0":1,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3764","projName":"tmerc","lat0":-0.767944870877505,"long0":-3.080506129769992,"k0":1,"x0":400000,"y0":800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3765","projName":"tmerc","lat0":0,"long0":0.2879793265790644,"k0":0.9999,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3766","projName":"lcc","lat1":0.8013970148740628,"lat2":0.7519460194008905,"lat0":0,"long0":0.2879793265790644,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3767","projName":"utm","zone":33,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3768","projName":"utm","zone":34,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3769","projName":"utm","zone":20,"ellps":"clrk66","datum_params":[-73,213,296,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3770","projName":"tmerc","lat0":0.5585053606381855,"long0":-1.1301006906663285,"k0":1,"x0":550000,"y0":100000,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3771","projName":"tmerc","lat0":0,"long0":-1.9373154697137058,"k0":0.9999,"x0":0,"y0":0,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"3772","projName":"tmerc","lat0":0,"long0":-1.9896753472735358,"k0":0.9999,"x0":0,"y0":0,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"3773","projName":"tmerc","lat0":0,"long0":-2.0420352248333655,"k0":0.9999,"x0":0,"y0":0,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"3774","projName":"tmerc","lat0":0,"long0":-2.0943951023931953,"k0":0.9999,"x0":0,"y0":0,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"3775","projName":"tmerc","lat0":0,"long0":-1.9373154697137058,"k0":0.9999,"x0":0,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3776","projName":"tmerc","lat0":0,"long0":-1.9896753472735358,"k0":0.9999,"x0":0,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3777","projName":"tmerc","lat0":0,"long0":-2.0420352248333655,"k0":0.9999,"x0":0,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3778","projName":"tmerc","lat0":0,"long0":-2.0943951023931953,"k0":0.9999,"x0":0,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3779","projName":"tmerc","lat0":0,"long0":-1.9373154697137058,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3780","projName":"tmerc","lat0":0,"long0":-1.9896753472735358,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3781","projName":"tmerc","lat0":0,"long0":-2.0420352248333655,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3782","projName":"tmerc","lat0":0,"long0":-2.0943951023931953,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3783","projName":"tmerc","lat0":-0.4375287817733105,"long0":-2.2708996756279833,"k0":1,"x0":14200,"y0":15500,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3784","projName":"utm","zone":9,"utmSouth":true,"ellps":"intl","datum_params":[185,165,42,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3785","projName":"merc","a":"6378137","b":"6378137","lat_ts":0,"long0":0,"x0":0,"y0":0,"k0":1,"units":"m","wktext":true,"no_defs":true},{"EPSG":"3786","projName":"eqc","lat_ts":0,"lat0":0,"long0":0,"x0":0,"y0":0,"a":"6371007","b":"6371007","units":"m","no_defs":true},{"EPSG":"3787","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":0.9999,"x0":500000,"y0":-5000000,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"3788","projName":"tmerc","lat0":0,"long0":2.897246558310587,"k0":1,"x0":3500000,"y0":10000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3789","projName":"tmerc","lat0":0,"long0":2.949606435870417,"k0":1,"x0":3500000,"y0":10000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3790","projName":"tmerc","lat0":0,"long0":3.12413936106985,"k0":1,"x0":3500000,"y0":10000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3791","projName":"tmerc","lat0":0,"long0":-3.1066860685499065,"k0":1,"x0":3500000,"y0":10000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3793","projName":"tmerc","lat0":0,"long0":-3.080506129769992,"k0":1,"x0":3500000,"y0":10000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3794","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":0.9999,"x0":500000,"y0":-5000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3795","projName":"lcc","lat1":0.4014257279586958,"lat2":0.3787364476827695,"lat0":0.3900810878207327,"long0":-1.413716694115407,"x0":500000,"y0":280296.016,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"3796","projName":"lcc","lat1":0.3717551306747922,"lat2":0.3513929560681916,"lat0":0.36157404337149196,"long0":-1.3409946419489764,"x0":500000,"y0":229126.939,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"3797","projName":"lcc","lat1":0.8726646259971648,"lat2":0.8028514559173916,"lat0":0.767944870877505,"long0":-1.2217304763960306,"x0":800000,"y0":0,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"3798","projName":"lcc","lat1":0.8726646259971648,"lat2":0.8028514559173916,"lat0":0.767944870877505,"long0":-1.2217304763960306,"x0":800000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3799","projName":"lcc","lat1":0.8726646259971648,"lat2":0.8028514559173916,"lat0":0.767944870877505,"long0":-1.2217304763960306,"x0":800000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3800","projName":"tmerc","lat0":0,"long0":-2.0943951023931953,"k0":0.9999,"x0":0,"y0":0,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"3801","projName":"tmerc","lat0":0,"long0":-2.0943951023931953,"k0":0.9999,"x0":0,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3802","projName":"tmerc","lat0":0,"long0":-2.0943951023931953,"k0":0.9999,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3812","projName":"lcc","lat1":0.8697557439105077,"lat2":0.8930268006037652,"lat0":0.8865891245689633,"long0":0.07608266909673504,"x0":649328,"y0":665262,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3814","projName":"tmerc","lat0":0.5672320068981571,"long0":-1.5664330036649108,"k0":0.9998335,"x0":500000,"y0":1300000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3815","projName":"tmerc","lat0":0.5672320068981571,"long0":-1.5664330036649108,"k0":0.9998335,"x0":500000,"y0":1300000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3816","projName":"tmerc","lat0":0.5672320068981571,"long0":-1.5664330036649108,"k0":0.9998335,"x0":500000,"y0":1300000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3825","projName":"tmerc","lat0":0,"long0":2.076941809873252,"k0":0.9999,"x0":250000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3826","projName":"tmerc","lat0":0,"long0":2.111848394913139,"k0":0.9999,"x0":250000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3827","projName":"tmerc","lat0":0,"long0":2.076941809873252,"k0":0.9999,"x0":250000,"y0":0,"ellps":"aust_SA","units":"m","no_defs":true},{"EPSG":"3828","projName":"tmerc","lat0":0,"long0":2.111848394913139,"k0":0.9999,"x0":250000,"y0":0,"ellps":"aust_SA","units":"m","no_defs":true},{"EPSG":"3829","projName":"utm","zone":51,"ellps":"intl","datum_params":[-637,-549,-203,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3832","projName":"merc","long0":2.6179938779914944,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3833","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":1,"x0":2500000,"y0":0,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"3834","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":1,"x0":2500000,"y0":0,"ellps":"krass","datum_params":[26,-121,-78,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3835","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":3500000,"y0":0,"ellps":"krass","datum_params":[26,-121,-78,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3836","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":4500000,"y0":0,"ellps":"krass","datum_params":[26,-121,-78,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3837","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":1,"x0":3500000,"y0":0,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"3838","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":1,"x0":4500000,"y0":0,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"3839","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":9500000,"y0":0,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"3840","projName":"tmerc","lat0":0,"long0":0.5235987755982988,"k0":1,"x0":10500000,"y0":0,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"3841","projName":"tmerc","lat0":0,"long0":0.3141592653589793,"k0":1,"x0":6500000,"y0":0,"ellps":"krass","datum_params":[26,-121,-78,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3842","projName":"tmerc","lat0":0,"long0":0.3141592653589793,"k0":1,"x0":6500000,"y0":0,"ellps":"krass","datum_params":[26,-121,-78,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3843","projName":"tmerc","lat0":0,"long0":0.3141592653589793,"k0":1,"x0":6500000,"y0":0,"ellps":"krass","datum_params":[26,-121,-78,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3844","projName":"sterea","lat0":0.8028514559173916,"long0":0.4363323129985824,"k0":0.99975,"x0":500000,"y0":500000,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"3845","projName":"tmerc","lat0":0,"long0":0.1973312885536089,"k0":1.000006,"x0":1500025.141,"y0":-667.282,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3846","projName":"tmerc","lat0":0,"long0":0.23660148761169,"k0":1.0000058,"x0":1500044.695,"y0":-667.13,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3847","projName":"tmerc","lat0":0,"long0":0.2758717075458483,"k0":1.00000561024,"x0":1500064.274,"y0":-667.711,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3848","projName":"tmerc","lat0":0,"long0":0.3151418857278521,"k0":1.0000054,"x0":1500083.521,"y0":-668.844,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3849","projName":"tmerc","lat0":0,"long0":0.3544120847859333,"k0":1.0000052,"x0":1500102.765,"y0":-670.706,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3850","projName":"tmerc","lat0":0,"long0":0.39368228384401427,"k0":1.0000049,"x0":1500121.846,"y0":-672.557,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3851","projName":"lcc","lat1":-0.6544984694978736,"lat2":-0.7766715171374766,"lat0":-0.7155849933176751,"long0":3.01941960595019,"x0":3000000,"y0":7000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3852","projName":"lcc","lat1":-1.3380857598623195,"lat2":-1.3846278732488346,"lat0":-1.5707963267948966,"long0":2.7401669256310974,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3854","projName":"tmerc","lat0":0,"long0":0.3151692873971085,"k0":0.99999506,"x0":100182.7406,"y0":-6500620.1207,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3857","projName":"merc","a":"6378137","b":"6378137","lat_ts":0,"long0":0,"x0":0,"y0":0,"k0":1,"units":"m","wktext":true,"no_defs":true},{"EPSG":"3873","projName":"tmerc","lat0":0,"long0":0.33161255787892263,"k0":1,"x0":19500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3874","projName":"tmerc","lat0":0,"long0":0.3490658503988659,"k0":1,"x0":20500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3875","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":21500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3876","projName":"tmerc","lat0":0,"long0":0.3839724354387525,"k0":1,"x0":22500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3877","projName":"tmerc","lat0":0,"long0":0.4014257279586958,"k0":1,"x0":23500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3878","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":1,"x0":24500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3879","projName":"tmerc","lat0":0,"long0":0.4363323129985824,"k0":1,"x0":25500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3880","projName":"tmerc","lat0":0,"long0":0.4537856055185257,"k0":1,"x0":26500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3881","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":27500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3882","projName":"tmerc","lat0":0,"long0":0.4886921905584123,"k0":1,"x0":28500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3883","projName":"tmerc","lat0":0,"long0":0.5061454830783556,"k0":1,"x0":29500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3884","projName":"tmerc","lat0":0,"long0":0.5235987755982988,"k0":1,"x0":30500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3885","projName":"tmerc","lat0":0,"long0":0.5410520681182421,"k0":1,"x0":31500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3890","projName":"utm","zone":37,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3891","projName":"utm","zone":38,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3892","projName":"utm","zone":39,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3893","projName":"tmerc","lat0":0.5066039519840335,"long0":0.8115781021773633,"k0":0.9994,"x0":800000,"y0":0,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3907","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":0.9999,"x0":5500000,"y0":0,"ellps":"bessel","datum_params":[682,-203,480,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3908","projName":"tmerc","lat0":0,"long0":0.3141592653589793,"k0":0.9999,"x0":6500000,"y0":0,"ellps":"bessel","datum_params":[682,-203,480,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3909","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":0.9999,"x0":7500000,"y0":0,"ellps":"bessel","datum_params":[682,-203,480,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3910","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":0.9999,"x0":8500000,"y0":0,"ellps":"bessel","datum_params":[682,-203,480,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3911","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":0.9999,"x0":500000,"y0":0,"ellps":"bessel","datum_params":[682,-203,480,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3912","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":0.9999,"x0":500000,"y0":-5000000,"ellps":"bessel","datum_params":[682,-203,480,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3920","projName":"utm","zone":20,"ellps":"clrk66","datum_params":[11,72,-101,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3942","projName":"lcc","lat1":0.7199483164476609,"lat2":0.7461282552275759,"lat0":0.7330382858376184,"long0":0.05235987755982989,"x0":1700000,"y0":1200000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3943","projName":"lcc","lat1":0.7374016089676042,"lat2":0.7635815477475192,"lat0":0.7504915783575618,"long0":0.05235987755982989,"x0":1700000,"y0":2200000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3944","projName":"lcc","lat1":0.7548549014875475,"lat2":0.7810348402674625,"lat0":0.767944870877505,"long0":0.05235987755982989,"x0":1700000,"y0":3200000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3945","projName":"lcc","lat1":0.7723081940074908,"lat2":0.7984881327874057,"lat0":0.7853981633974483,"long0":0.05235987755982989,"x0":1700000,"y0":4200000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3946","projName":"lcc","lat1":0.7897614865274342,"lat2":0.815941425307349,"lat0":0.8028514559173916,"long0":0.05235987755982989,"x0":1700000,"y0":5200000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3947","projName":"lcc","lat1":0.8072147790473774,"lat2":0.8333947178272924,"lat0":0.8203047484373349,"long0":0.05235987755982989,"x0":1700000,"y0":6200000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3948","projName":"lcc","lat1":0.8246680715673207,"lat2":0.8508480103472357,"lat0":0.8377580409572782,"long0":0.05235987755982989,"x0":1700000,"y0":7200000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3949","projName":"lcc","lat1":0.842121364087264,"lat2":0.868301302867179,"lat0":0.8552113334772214,"long0":0.05235987755982989,"x0":1700000,"y0":8200000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3950","projName":"lcc","lat1":0.8595746566072073,"lat2":0.8857545953871222,"lat0":0.8726646259971648,"long0":0.05235987755982989,"x0":1700000,"y0":9200000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3968","projName":"lcc","lat1":0.6457718232379019,"lat2":0.6894050545377601,"lat0":0.6283185307179586,"long0":-1.387536755335492,"x0":0,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3969","projName":"lcc","lat1":0.6457718232379019,"lat2":0.6894050545377601,"lat0":0.6283185307179586,"long0":-1.387536755335492,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3970","projName":"lcc","lat1":0.6457718232379019,"lat2":0.6894050545377601,"lat0":0.6283185307179586,"long0":-1.387536755335492,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3973","projName":"laea","lat0":1.5707963267948966,"long0":0,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3974","projName":"laea","lat0":-1.5707963267948966,"long0":0,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3975","projName":"cea","long0":0,"lat_ts":0.5235987755982988,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3976","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.2217304763960306,"long0":0,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3978","projName":"lcc","lat1":0.8552113334772214,"lat2":1.3439035240356338,"lat0":0.8552113334772214,"long0":-1.6580627893946132,"x0":0,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"3979","projName":"lcc","lat1":0.8552113334772214,"lat2":1.3439035240356338,"lat0":0.8552113334772214,"long0":-1.6580627893946132,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3985","projName":"lcc","lat1":-0.11344640137963143,"lat2":-0.2007128639793479,"lat0":0.15707963267948966,"long0":0.4537856055185257,"x0":500000,"y0":500000,"ellps":"clrk66","datum_params":[-103.746,-9.614,-255.95,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3986","projName":"tmerc","lat0":-0.15707963267948966,"long0":0.5235987755982988,"k0":1,"x0":200000,"y0":500000,"ellps":"clrk66","datum_params":[-103.746,-9.614,-255.95,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3987","projName":"tmerc","lat0":-0.15707963267948966,"long0":0.4886921905584123,"k0":1,"x0":200000,"y0":500000,"ellps":"clrk66","datum_params":[-103.746,-9.614,-255.95,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3988","projName":"tmerc","lat0":-0.15707963267948966,"long0":0.4537856055185257,"k0":1,"x0":200000,"y0":500000,"ellps":"clrk66","datum_params":[-103.746,-9.614,-255.95,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3989","projName":"tmerc","lat0":-0.15707963267948966,"long0":0.4188790204786391,"k0":1,"x0":200000,"y0":500000,"ellps":"clrk66","datum_params":[-103.746,-9.614,-255.95,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"3991","projName":"lcc","lat1":0.321722358784288,"lat2":0.31474104177631074,"lat0":0.311250383272322,"long0":-1.1594803997415664,"x0":152400.3048006096,"y0":0,"ellps":"clrk66","datum_params":[11,72,-101,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3992","projName":"lcc","lat1":0.321722358784288,"lat2":0.31474104177631074,"lat0":0.311250383272322,"long0":-1.1594803997415664,"x0":152400.3048006096,"y0":30480.06096012192,"ellps":"clrk66","datum_params":[11,72,-101,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"3994","projName":"merc","long0":1.7453292519943295,"lat_ts":-0.7155849933176751,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3995","projName":"stere","lat0":1.5707963267948966,"lat_ts":1.239183768915974,"long0":0,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3996","projName":"stere","lat0":1.5707963267948966,"lat_ts":1.3089969389957472,"long0":0,"k0":1,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"3997","projName":"tmerc","lat0":0,"long0":0.9657488527701958,"k0":1,"x0":500000,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"4026","projName":"tmerc","lat0":0,"long0":0.49567350756638956,"k0":0.99994,"x0":200000,"y0":-5000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4037","projName":"utm","zone":35,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"4038","projName":"utm","zone":36,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"4048","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4049","projName":"tmerc","lat0":0,"long0":0.24434609527920614,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4050","projName":"tmerc","lat0":0,"long0":0.2792526803190927,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4051","projName":"tmerc","lat0":0,"long0":0.3141592653589793,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4056","projName":"tmerc","lat0":0,"long0":0.3490658503988659,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4057","projName":"tmerc","lat0":0,"long0":0.3839724354387525,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4058","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4059","projName":"tmerc","lat0":0,"long0":0.4537856055185257,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4060","projName":"tmerc","lat0":0,"long0":0.4886921905584123,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4061","projName":"utm","zone":33,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4062","projName":"utm","zone":34,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4063","projName":"utm","zone":35,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4071","projName":"utm","zone":23,"utmSouth":true,"ellps":"intl","datum_params":[-134,229,-29,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4082","projName":"utm","zone":27,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4083","projName":"utm","zone":28,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4087","projName":"eqc","lat_ts":0,"lat0":0,"long0":0,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"4088","projName":"eqc","lat_ts":0,"lat0":0,"long0":0,"x0":0,"y0":0,"a":"6371007","b":"6371007","units":"m","no_defs":true},{"EPSG":"4093","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":0.99998,"x0":200000,"y0":-5000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4094","projName":"tmerc","lat0":0,"long0":0.17453292519943295,"k0":0.99998,"x0":400000,"y0":-5000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4095","projName":"tmerc","lat0":0,"long0":0.20507618710933373,"k0":0.99998,"x0":600000,"y0":-5000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4096","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":800000,"y0":-5000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4217","projName":"tmerc","lat0":0,"long0":2.9845130209103035,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"4399","projName":"tmerc","lat0":0,"long0":2.9845130209103035,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"4400","projName":"tmerc","lat0":0,"long0":3.0892327760299634,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"4401","projName":"tmerc","lat0":0,"long0":-3.0892327760299634,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"4402","projName":"tmerc","lat0":0,"long0":-2.9845130209103035,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"4403","projName":"tmerc","lat0":0,"long0":-2.8797932657906435,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"4404","projName":"tmerc","lat0":0,"long0":-2.775073510670984,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"4405","projName":"tmerc","lat0":0,"long0":-2.670353755551324,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"4406","projName":"tmerc","lat0":0,"long0":-2.5656340004316642,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"4407","projName":"tmerc","lat0":0,"long0":-2.4609142453120048,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"4408","projName":"tmerc","lat0":0,"long0":-2.356194490192345,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"4409","projName":"tmerc","lat0":0,"long0":-2.251474735072685,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"4410","projName":"tmerc","lat0":0,"long0":-2.1467549799530254,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"4411","projName":"tmerc","lat0":0,"long0":-2.0420352248333655,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"4412","projName":"tmerc","lat0":0,"long0":-1.9373154697137058,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"4413","projName":"tmerc","lat0":0,"long0":-1.8325957145940461,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"4414","projName":"tmerc","lat0":0.23561944901923448,"long0":2.526364092261792,"k0":1,"x0":100000,"y0":200000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4415","projName":"lcc","lat1":-0.11344640137963143,"lat2":-0.2007128639793479,"lat0":-0.15707963267948966,"long0":0.4537856055185257,"x0":500000,"y0":500000,"ellps":"clrk66","datum_params":[-103.746,-9.614,-255.95,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4417","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":7500000,"y0":0,"ellps":"krass","datum_params":[26,-121,-78,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4418","projName":"tmerc","lat0":0,"long0":-1.3089969389957472,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"4419","projName":"tmerc","lat0":0,"long0":-1.2042771838760873,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"4420","projName":"tmerc","lat0":0,"long0":3.0892327760299634,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"4421","projName":"tmerc","lat0":0,"long0":-3.0892327760299634,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"4422","projName":"tmerc","lat0":0,"long0":-2.9845130209103035,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"4423","projName":"tmerc","lat0":0,"long0":-2.8797932657906435,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"4424","projName":"tmerc","lat0":0,"long0":-2.775073510670984,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"4425","projName":"tmerc","lat0":0,"long0":-2.670353755551324,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"4426","projName":"tmerc","lat0":0,"long0":-2.5656340004316642,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"4427","projName":"tmerc","lat0":0,"long0":-2.4609142453120048,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"4428","projName":"tmerc","lat0":0,"long0":-2.356194490192345,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"4429","projName":"tmerc","lat0":0,"long0":-2.251474735072685,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"4430","projName":"tmerc","lat0":0,"long0":-2.1467549799530254,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"4431","projName":"tmerc","lat0":0,"long0":-2.0420352248333655,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"4432","projName":"tmerc","lat0":0,"long0":-1.9373154697137058,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"4433","projName":"tmerc","lat0":0,"long0":-1.8325957145940461,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"4434","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":1,"x0":8500000,"y0":0,"ellps":"krass","datum_params":[26,-121,-78,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4437","projName":"lcc","lat1":0.321722358784288,"lat2":0.31474104177631074,"lat0":0.311250383272322,"long0":-1.1594803997415664,"x0":200000,"y0":200000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4438","projName":"tmerc","lat0":0,"long0":-1.3089969389957472,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"4439","projName":"tmerc","lat0":0,"long0":-1.2042771838760873,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"4455","projName":"lcc","lat1":0.7150032169003437,"lat2":0.6969681479630688,"lat0":0.6864961724511032,"long0":-1.3569934934255912,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"4456","projName":"lcc","lat1":0.7161667697350065,"lat2":0.7097672291443605,"lat0":0.7068583470577035,"long0":-1.2915436464758039,"x0":609601.2192024384,"y0":30480.06096012192,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"4457","projName":"lcc","lat1":0.7973245799527429,"lat2":0.7752170760941479,"lat0":0.765035988790848,"long0":-1.7453292519943295,"x0":600000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"4462","projName":"lcc","lat1":-0.3141592653589793,"lat2":-0.6283185307179586,"lat0":-0.47123889803846897,"long0":2.303834612632515,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"4467","projName":"utm","zone":21,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4471","projName":"utm","zone":38,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4474","projName":"utm","zone":38,"utmSouth":true,"ellps":"intl","datum_params":[-382,-59,-262,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4484","projName":"utm","zone":11,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4485","projName":"utm","zone":12,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4486","projName":"utm","zone":13,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4487","projName":"utm","zone":14,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4488","projName":"utm","zone":15,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4489","projName":"utm","zone":16,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4491","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":13500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4492","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":14500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4493","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":15500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4494","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":16500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4495","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":17500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4496","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":18500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4497","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":19500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4498","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":20500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4499","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":21500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4500","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":22500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4501","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":23500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4502","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4503","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4504","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4505","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4506","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4507","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4508","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4509","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4510","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4511","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4512","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4513","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":25500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4514","projName":"tmerc","lat0":0,"long0":1.361356816555577,"k0":1,"x0":26500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4515","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":27500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4516","projName":"tmerc","lat0":0,"long0":1.4660765716752369,"k0":1,"x0":28500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4517","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":29500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4518","projName":"tmerc","lat0":0,"long0":1.5707963267948966,"k0":1,"x0":30500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4519","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":31500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4520","projName":"tmerc","lat0":0,"long0":1.6755160819145565,"k0":1,"x0":32500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4521","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":33500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4522","projName":"tmerc","lat0":0,"long0":1.7802358370342162,"k0":1,"x0":34500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4523","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":35500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4524","projName":"tmerc","lat0":0,"long0":1.8849555921538759,"k0":1,"x0":36500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4525","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":37500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4526","projName":"tmerc","lat0":0,"long0":1.9896753472735358,"k0":1,"x0":38500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4527","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":39500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4528","projName":"tmerc","lat0":0,"long0":2.0943951023931953,"k0":1,"x0":40500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4529","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":41500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4530","projName":"tmerc","lat0":0,"long0":2.199114857512855,"k0":1,"x0":42500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4531","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":43500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4532","projName":"tmerc","lat0":0,"long0":2.303834612632515,"k0":1,"x0":44500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4533","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":45500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4534","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4535","projName":"tmerc","lat0":0,"long0":1.361356816555577,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4536","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4537","projName":"tmerc","lat0":0,"long0":1.4660765716752369,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4538","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4539","projName":"tmerc","lat0":0,"long0":1.5707963267948966,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4540","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4541","projName":"tmerc","lat0":0,"long0":1.6755160819145565,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4542","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4543","projName":"tmerc","lat0":0,"long0":1.7802358370342162,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4544","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4545","projName":"tmerc","lat0":0,"long0":1.8849555921538759,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4546","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4547","projName":"tmerc","lat0":0,"long0":1.9896753472735358,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4548","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4549","projName":"tmerc","lat0":0,"long0":2.0943951023931953,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4550","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4551","projName":"tmerc","lat0":0,"long0":2.199114857512855,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4552","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4553","projName":"tmerc","lat0":0,"long0":2.303834612632515,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4554","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"4559","projName":"utm","zone":20,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4568","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":13500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4569","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":14500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4570","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":15500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4571","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":16500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4572","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":17500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4573","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":18500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4574","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":19500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4575","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":20500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4576","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":21500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4577","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":22500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4578","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":23500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4579","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4580","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4581","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4582","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4583","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4584","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4585","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4586","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4587","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4588","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4589","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4647","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":0.9996,"x0":32500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4652","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":25500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4653","projName":"tmerc","lat0":0,"long0":1.361356816555577,"k0":1,"x0":26500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4654","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":27500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4655","projName":"tmerc","lat0":0,"long0":1.4660765716752369,"k0":1,"x0":28500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4656","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":29500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4766","projName":"tmerc","lat0":0,"long0":1.5707963267948966,"k0":1,"x0":30500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4767","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":31500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4768","projName":"tmerc","lat0":0,"long0":1.6755160819145565,"k0":1,"x0":32500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4769","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":33500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4770","projName":"tmerc","lat0":0,"long0":1.7802358370342162,"k0":1,"x0":34500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4771","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":35500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4772","projName":"tmerc","lat0":0,"long0":1.8849555921538759,"k0":1,"x0":36500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4773","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":37500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4774","projName":"tmerc","lat0":0,"long0":1.9896753472735358,"k0":1,"x0":38500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4775","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":39500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4776","projName":"tmerc","lat0":0,"long0":2.0943951023931953,"k0":1,"x0":40500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4777","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":41500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4778","projName":"tmerc","lat0":0,"long0":2.199114857512855,"k0":1,"x0":42500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4779","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":43500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4780","projName":"tmerc","lat0":0,"long0":2.303834612632515,"k0":1,"x0":44500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4781","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":45500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4782","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4783","projName":"tmerc","lat0":0,"long0":1.361356816555577,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4784","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4785","projName":"tmerc","lat0":0,"long0":1.4660765716752369,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4786","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4787","projName":"tmerc","lat0":0,"long0":1.5707963267948966,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4788","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4789","projName":"tmerc","lat0":0,"long0":1.6755160819145565,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4790","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4791","projName":"tmerc","lat0":0,"long0":1.7802358370342162,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4792","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4793","projName":"tmerc","lat0":0,"long0":1.8849555921538759,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4794","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4795","projName":"tmerc","lat0":0,"long0":1.9896753472735358,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4796","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4797","projName":"tmerc","lat0":0,"long0":2.0943951023931953,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4798","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4799","projName":"tmerc","lat0":0,"long0":2.199114857512855,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4800","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4812","projName":"tmerc","lat0":0,"long0":2.303834612632515,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4822","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":500000,"y0":0,"ellps":"krass","units":"m","no_defs":true},{"EPSG":"4826","projName":"lcc","lat1":0.2617993877991494,"lat2":0.2908882086657217,"lat0":0.27634379823243543,"long0":-0.4188790204786391,"x0":161587.83,"y0":128511.202,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"4839","projName":"lcc","lat1":0.8493935693039069,"lat2":0.9366600319036233,"lat0":0.8901179185171081,"long0":0.1832595714594046,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4855","projName":"tmerc","lat0":0,"long0":0.09599310885968812,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4856","projName":"tmerc","lat0":0,"long0":0.11344640137963143,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4857","projName":"tmerc","lat0":0,"long0":0.1308996938995747,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4858","projName":"tmerc","lat0":0,"long0":0.14835298641951802,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4859","projName":"tmerc","lat0":0,"long0":0.16580627893946132,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4860","projName":"tmerc","lat0":0,"long0":0.1832595714594046,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4861","projName":"tmerc","lat0":0,"long0":0.2007128639793479,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4862","projName":"tmerc","lat0":0,"long0":0.2181661564992912,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4863","projName":"tmerc","lat0":0,"long0":0.23561944901923448,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4864","projName":"tmerc","lat0":0,"long0":0.2530727415391778,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4865","projName":"tmerc","lat0":0,"long0":0.27052603405912107,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4866","projName":"tmerc","lat0":0,"long0":0.2879793265790644,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4867","projName":"tmerc","lat0":0,"long0":0.30543261909900765,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4868","projName":"tmerc","lat0":0,"long0":0.32288591161895097,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4869","projName":"tmerc","lat0":0,"long0":0.34033920413889424,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4870","projName":"tmerc","lat0":0,"long0":0.35779249665883756,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4871","projName":"tmerc","lat0":0,"long0":0.3752457891787809,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4872","projName":"tmerc","lat0":0,"long0":0.39269908169872414,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4873","projName":"tmerc","lat0":0,"long0":0.41015237421866746,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4874","projName":"tmerc","lat0":0,"long0":0.4276056667386107,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4875","projName":"tmerc","lat0":0,"long0":0.44505895925855404,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4876","projName":"tmerc","lat0":0,"long0":0.4625122517784973,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4877","projName":"tmerc","lat0":0,"long0":0.4799655442984406,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4878","projName":"tmerc","lat0":0,"long0":0.49741883681838395,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4879","projName":"tmerc","lat0":0,"long0":0.5148721293383273,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"4880","projName":"tmerc","lat0":0,"long0":0.5323254218582705,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5014","projName":"utm","zone":25,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5015","projName":"utm","zone":26,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5016","projName":"utm","zone":28,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5018","projName":"tmerc","lat0":0.6923139366244172,"long0":-0.14192853610193676,"k0":1,"x0":0,"y0":0,"ellps":"intl","datum_params":[-304.046,-60.576,103.64,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5041","projName":"stere","lat0":1.5707963267948966,"lat_ts":1.5707963267948966,"long0":0,"k0":0.994,"x0":2000000,"y0":2000000,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"5042","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.5707963267948966,"long0":0,"k0":0.994,"x0":2000000,"y0":2000000,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"5048","projName":"utm","zone":35,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5069","projName":"aea","lat1":0.5148721293383273,"lat2":0.7941248096574199,"lat0":0.4014257279586958,"long0":-1.6755160819145565,"x0":0,"y0":0,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"5070","projName":"aea","lat1":0.5148721293383273,"lat2":0.7941248096574199,"lat0":0.4014257279586958,"long0":-1.6755160819145565,"x0":0,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"5071","projName":"aea","lat1":0.5148721293383273,"lat2":0.7941248096574199,"lat0":0.4014257279586958,"long0":-1.6755160819145565,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5072","projName":"aea","lat1":0.5148721293383273,"lat2":0.7941248096574199,"lat0":0.4014257279586958,"long0":-1.6755160819145565,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5105","projName":"tmerc","lat0":1.0122909661567112,"long0":0.09599310885968812,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5106","projName":"tmerc","lat0":1.0122909661567112,"long0":0.11344640137963143,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5107","projName":"tmerc","lat0":1.0122909661567112,"long0":0.1308996938995747,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5108","projName":"tmerc","lat0":1.0122909661567112,"long0":0.14835298641951802,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5109","projName":"tmerc","lat0":1.0122909661567112,"long0":0.16580627893946132,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5110","projName":"tmerc","lat0":1.0122909661567112,"long0":0.1832595714594046,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5111","projName":"tmerc","lat0":1.0122909661567112,"long0":0.2007128639793479,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5112","projName":"tmerc","lat0":1.0122909661567112,"long0":0.2181661564992912,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5113","projName":"tmerc","lat0":1.0122909661567112,"long0":0.23561944901923448,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5114","projName":"tmerc","lat0":1.0122909661567112,"long0":0.2530727415391778,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5115","projName":"tmerc","lat0":1.0122909661567112,"long0":0.27052603405912107,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5116","projName":"tmerc","lat0":1.0122909661567112,"long0":0.2879793265790644,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5117","projName":"tmerc","lat0":1.0122909661567112,"long0":0.30543261909900765,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5118","projName":"tmerc","lat0":1.0122909661567112,"long0":0.32288591161895097,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5119","projName":"tmerc","lat0":1.0122909661567112,"long0":0.34033920413889424,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5120","projName":"tmerc","lat0":1.0122909661567112,"long0":0.35779249665883756,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5121","projName":"tmerc","lat0":1.0122909661567112,"long0":0.3752457891787809,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5122","projName":"tmerc","lat0":1.0122909661567112,"long0":0.39269908169872414,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5123","projName":"tmerc","lat0":1.0122909661567112,"long0":0.41015237421866746,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5124","projName":"tmerc","lat0":1.0122909661567112,"long0":0.4276056667386107,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5125","projName":"tmerc","lat0":1.0122909661567112,"long0":0.44505895925855404,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5126","projName":"tmerc","lat0":1.0122909661567112,"long0":0.4625122517784973,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5127","projName":"tmerc","lat0":1.0122909661567112,"long0":0.4799655442984406,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5128","projName":"tmerc","lat0":1.0122909661567112,"long0":0.49741883681838395,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5129","projName":"tmerc","lat0":1.0122909661567112,"long0":0.5148721293383273,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5130","projName":"tmerc","lat0":1.0122909661567112,"long0":0.5323254218582705,"k0":1,"x0":100000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5167","projName":"tmerc","lat0":0.6632251157578453,"long0":2.2863813201125716,"k0":1,"x0":200000,"y0":500000,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"5168","projName":"tmerc","lat0":0.6632251157578453,"long0":2.2165681500327987,"k0":1,"x0":200000,"y0":550000,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"5169","projName":"tmerc","lat0":0.6632251157578453,"long0":2.181661564992912,"k0":1,"x0":200000,"y0":500000,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"5170","projName":"tmerc","lat0":0.6632251157578453,"long0":2.2165681500327987,"k0":1,"x0":200000,"y0":500000,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"5171","projName":"tmerc","lat0":0.6632251157578453,"long0":2.251474735072685,"k0":1,"x0":200000,"y0":500000,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"5172","projName":"tmerc","lat0":0.6632251157578453,"long0":2.2863813201125716,"k0":1,"x0":200000,"y0":500000,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"5173","projName":"tmerc","lat0":0.6632251157578453,"long0":2.1817120098564318,"k0":1,"x0":200000,"y0":500000,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"5174","projName":"tmerc","lat0":0.6632251157578453,"long0":2.2166185948963184,"k0":1,"x0":200000,"y0":500000,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"5175","projName":"tmerc","lat0":0.6632251157578453,"long0":2.2166185948963184,"k0":1,"x0":200000,"y0":550000,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"5176","projName":"tmerc","lat0":0.6632251157578453,"long0":2.251525179936205,"k0":1,"x0":200000,"y0":500000,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"5177","projName":"tmerc","lat0":0.6632251157578453,"long0":2.2864317649760912,"k0":1,"x0":200000,"y0":500000,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"5178","projName":"tmerc","lat0":0.6632251157578453,"long0":2.2252947962927703,"k0":0.9996,"x0":1000000,"y0":2000000,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"5179","projName":"tmerc","lat0":0.6632251157578453,"long0":2.2252947962927703,"k0":0.9996,"x0":1000000,"y0":2000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5180","projName":"tmerc","lat0":0.6632251157578453,"long0":2.181661564992912,"k0":1,"x0":200000,"y0":500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5181","projName":"tmerc","lat0":0.6632251157578453,"long0":2.2165681500327987,"k0":1,"x0":200000,"y0":500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5182","projName":"tmerc","lat0":0.6632251157578453,"long0":2.2165681500327987,"k0":1,"x0":200000,"y0":550000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5183","projName":"tmerc","lat0":0.6632251157578453,"long0":2.251474735072685,"k0":1,"x0":200000,"y0":500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5184","projName":"tmerc","lat0":0.6632251157578453,"long0":2.2863813201125716,"k0":1,"x0":200000,"y0":500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5185","projName":"tmerc","lat0":0.6632251157578453,"long0":2.181661564992912,"k0":1,"x0":200000,"y0":600000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5186","projName":"tmerc","lat0":0.6632251157578453,"long0":2.2165681500327987,"k0":1,"x0":200000,"y0":600000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5187","projName":"tmerc","lat0":0.6632251157578453,"long0":2.251474735072685,"k0":1,"x0":200000,"y0":600000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5188","projName":"tmerc","lat0":0.6632251157578453,"long0":2.2863813201125716,"k0":1,"x0":200000,"y0":600000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5221","projName":"krovak","lat0":0.8639379797371931,"long0":0.7417649320975901,"alpha":0.5286277624568585,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[589,76,480,0,0,0,0],"from_greenwich":-0.30834150118567066,"units":"m","no_defs":true},{"EPSG":"5223","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":0.9996,"x0":500000,"y0":500000,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"5234","projName":"tmerc","lat0":0.12218143006814945,"long0":1.4097323013585765,"k0":0.9999238418,"x0":200000,"y0":200000,"a":"6377276.345","b":"6356075.41314024","datum_params":[-97,787,86,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5235","projName":"tmerc","lat0":0.12218127735183991,"long0":1.4097323357803477,"k0":0.9999238418,"x0":500000,"y0":500000,"a":"6377276.345","b":"6356075.41314024","datum_params":[-0.293,766.95,87.713,0.195704,1.69507,3.47302,-0.039338],"units":"m","no_defs":true},{"EPSG":"5243","projName":"lcc","lat1":0.8493935693039069,"lat2":0.9366600319036233,"lat0":0.8901179185171081,"long0":0.1832595714594046,"x0":0,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5247","projName":"omerc","lat0":0.06981317007977318,"longc":2.007128639793479,"alpha":0.9305364269950533,"k0":0.99984,"x0":0,"y0":0,"no_uoff":true,"gamma":"53.13010236111111","ellps":"GRS80","units":"m","no_defs":true},{"EPSG":"5253","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5254","projName":"tmerc","lat0":0,"long0":0.5235987755982988,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5255","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5256","projName":"tmerc","lat0":0,"long0":0.6283185307179586,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5257","projName":"tmerc","lat0":0,"long0":0.6806784082777885,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5258","projName":"tmerc","lat0":0,"long0":0.7330382858376184,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5259","projName":"tmerc","lat0":0,"long0":0.7853981633974483,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5266","projName":"tmerc","lat0":0,"long0":1.5707963267948966,"k0":1,"x0":250000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5269","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":9500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5270","projName":"tmerc","lat0":0,"long0":0.5235987755982988,"k0":1,"x0":10500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5271","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":11500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5272","projName":"tmerc","lat0":0,"long0":0.6283185307179586,"k0":1,"x0":12500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5273","projName":"tmerc","lat0":0,"long0":0.6806784082777885,"k0":1,"x0":13500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5274","projName":"tmerc","lat0":0,"long0":0.7330382858376184,"k0":1,"x0":14500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5275","projName":"tmerc","lat0":0,"long0":0.7853981633974483,"k0":1,"x0":15500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5292","projName":"tmerc","lat0":0,"long0":1.5835954079761883,"k0":1,"x0":250000,"y0":-2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5293","projName":"tmerc","lat0":0,"long0":1.5629423451609221,"k0":1,"x0":250000,"y0":-2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5294","projName":"tmerc","lat0":0,"long0":1.568178332916905,"k0":1,"x0":250000,"y0":-2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5295","projName":"tmerc","lat0":0,"long0":1.571378103212228,"k0":1,"x0":250000,"y0":-2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5296","projName":"tmerc","lat0":0,"long0":1.5734143206728881,"k0":1,"x0":250000,"y0":-2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5297","projName":"tmerc","lat0":0,"long0":1.5905767249841658,"k0":1,"x0":250000,"y0":-2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5298","projName":"tmerc","lat0":0,"long0":1.59232205423616,"k0":1,"x0":250000,"y0":-2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5299","projName":"tmerc","lat0":0,"long0":1.5594516866569335,"k0":1,"x0":250000,"y0":-2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5300","projName":"tmerc","lat0":0,"long0":1.5943582716968199,"k0":1,"x0":250000,"y0":-2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5301","projName":"tmerc","lat0":0,"long0":1.568178332916905,"k0":1,"x0":250000,"y0":-2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5302","projName":"tmerc","lat0":0,"long0":1.5981398184094744,"k0":1,"x0":250000,"y0":-2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5303","projName":"tmerc","lat0":0,"long0":1.5545065871096162,"k0":1,"x0":250000,"y0":-2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5304","projName":"tmerc","lat0":0,"long0":1.5754505381335482,"k0":1,"x0":250000,"y0":-2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5305","projName":"tmerc","lat0":0,"long0":1.5629423451609221,"k0":1,"x0":250000,"y0":-2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5306","projName":"tmerc","lat0":0,"long0":1.6013395887047974,"k0":1,"x0":250000,"y0":-2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5307","projName":"tmerc","lat0":0,"long0":1.5795229730548683,"k0":1,"x0":250000,"y0":-2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5308","projName":"tmerc","lat0":0,"long0":1.573705208881554,"k0":1,"x0":250000,"y0":-2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5309","projName":"tmerc","lat0":0,"long0":1.5728325442555566,"k0":1,"x0":250000,"y0":-2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5310","projName":"tmerc","lat0":0,"long0":1.5981398184094744,"k0":1,"x0":250000,"y0":-2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5311","projName":"tmerc","lat0":0,"long0":1.585922513645514,"k0":1,"x0":250000,"y0":-2500000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5316","projName":"tmerc","lat0":0,"long0":-0.12217304763960307,"k0":0.999997,"x0":200000,"y0":-6000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5320","projName":"lcc","lat1":0.7766715171374766,"lat2":0.9512044423369096,"lat0":0,"long0":-1.4660765716752369,"x0":1000000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"5321","projName":"lcc","lat1":0.7766715171374766,"lat2":0.9512044423369096,"lat0":0,"long0":-1.4660765716752369,"x0":1000000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5325","projName":"lcc","lat1":1.1213740444063567,"lat2":1.1475539831862718,"lat0":1.1344640137963142,"long0":-0.33161255787892263,"x0":1700000,"y0":300000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5329","projName":"merc","long0":0.05571580634183821,"k0":0.997,"x0":3900000,"y0":900000,"ellps":"bessel","datum_params":[-403,684,41,0,0,0,0],"from_greenwich":1.8641463708519166,"units":"m","no_defs":true},{"EPSG":"5330","projName":"merc","long0":0.05571580634183821,"k0":0.997,"x0":3900000,"y0":900000,"ellps":"bessel","datum_params":[-377,681,-50,0,0,0,0],"from_greenwich":1.8641463708519166,"units":"m","no_defs":true},{"EPSG":"5331","projName":"merc","long0":0.05571580634183821,"k0":0.997,"x0":3900000,"y0":900000,"ellps":"bessel","datum_params":[-587.8,519.75,145.76,0,0,0,0],"from_greenwich":1.8641463708519166,"units":"m","no_defs":true},{"EPSG":"5337","projName":"utm","zone":25,"utmSouth":true,"ellps":"intl","datum_params":[-151.99,287.04,-147.45,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5343","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.2566370614359172,"k0":1,"x0":1500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5344","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.2042771838760873,"k0":1,"x0":2500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5345","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.1519173063162575,"k0":1,"x0":3500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5346","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.0995574287564276,"k0":1,"x0":4500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5347","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.0471975511965976,"k0":1,"x0":5500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5348","projName":"tmerc","lat0":-1.5707963267948966,"long0":-0.9948376736367679,"k0":1,"x0":6500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5349","projName":"tmerc","lat0":-1.5707963267948966,"long0":-0.9424777960769379,"k0":1,"x0":7500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5355","projName":"utm","zone":20,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5356","projName":"utm","zone":19,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5357","projName":"utm","zone":21,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5361","projName":"utm","zone":19,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5362","projName":"utm","zone":18,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5367","projName":"tmerc","lat0":0,"long0":-1.4660765716752369,"k0":0.9999,"x0":500000,"y0":0,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5382","projName":"utm","zone":21,"utmSouth":true,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5383","projName":"utm","zone":22,"utmSouth":true,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5387","projName":"utm","zone":18,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5388","projName":"utm","zone":17,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5389","projName":"utm","zone":19,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5396","projName":"utm","zone":26,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5456","projName":"lcc","lat1":0.1826777950420732,"lat0":0.1826777950420732,"long0":-1.4718943358485512,"k0":0.99995696,"x0":500000,"y0":271820.522,"ellps":"clrk66","datum_params":[213.11,9.37,-74.95,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5457","projName":"lcc","lat1":0.15707963267948966,"lat0":0.15707963267948966,"long0":-1.4602588075019225,"k0":0.99995696,"x0":500000,"y0":327987.436,"ellps":"clrk66","datum_params":[213.11,9.37,-74.95,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5458","projName":"lcc","lat1":0.2935062025437131,"lat0":0.2935062025437131,"long0":-1.576614090968211,"k0":0.99992226,"x0":500000,"y0":292209.579,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"5459","projName":"lcc","lat1":0.26005405854715513,"lat0":0.26005405854715513,"long0":-1.576614090968211,"k0":0.99989906,"x0":500000,"y0":325992.681,"ellps":"clrk66","datum_params":[213.11,9.37,-74.95,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5460","projName":"lcc","lat1":0.24056454856655168,"lat0":0.24056454856655168,"long0":-1.5533430342749532,"k0":0.99996704,"x0":500000,"y0":295809.184,"ellps":"clrk66","datum_params":[213.11,9.37,-74.95,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5461","projName":"lcc","lat1":0.24201898960988044,"lat0":0.24201898960988044,"long0":-1.4922565104551517,"k0":0.99990314,"x0":500000,"y0":359891.816,"ellps":"clrk66","datum_params":[213.11,9.37,-74.95,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5462","projName":"lcc","lat1":0.20478529890066796,"lat0":0.20478529890066796,"long0":-1.4922565104551517,"k0":0.99992228,"x0":500000,"y0":288876.327,"ellps":"clrk66","datum_params":[213.11,9.37,-74.95,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5463","projName":"utm","zone":17,"ellps":"aust_SA","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5466","projName":"tmerc","lat0":0.297774846409915,"long0":-1.54691773553343,"k0":1,"x0":66220.02833082761,"y0":135779.5099885299,"a":"6378293.645208759","b":"6356617.987679838","units":"m","no_defs":true},{"EPSG":"5469","projName":"lcc","lat1":0.1468985453761894,"lat0":0.1468985453761894,"long0":-1.3962634015954636,"k0":0.99989909,"x0":500000,"y0":294865.303,"ellps":"clrk66","units":"m","no_defs":true},{"EPSG":"5472","projName":"poly","lat0":0.1439896632895322,"long0":-1.413716694115407,"x0":914391.7962,"y0":999404.7217154861,"ellps":"clrk66","to_meter":0.9143917962,"no_defs":true},{"EPSG":"5479","projName":"lcc","lat1":-1.3380857598623195,"lat2":-1.3846278732488346,"lat0":-1.361356816555577,"long0":2.8448866807507573,"x0":7000000,"y0":5000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5480","projName":"lcc","lat1":-1.2857258823024895,"lat2":-1.3148147031690616,"lat0":-1.3002702927357754,"long0":2.8797932657906435,"x0":5000000,"y0":3000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5481","projName":"lcc","lat1":-1.2333660047426596,"lat2":-1.2624548256092316,"lat0":-1.2479104151759457,"long0":2.897246558310587,"x0":3000000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5482","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.5707963267948966,"long0":3.141592653589793,"k0":0.994,"x0":5000000,"y0":1000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5490","projName":"utm","zone":20,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5513","projName":"krovak","lat0":0.8639379797371931,"long0":0.4334234309119251,"alpha":0.5286277624568585,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[589,76,480,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5514","projName":"krovak","lat0":0.8639379797371931,"long0":0.4334234309119251,"alpha":0.5286277624568585,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[589,76,480,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5518","projName":"tmerc","lat0":-0.767944870877505,"long0":-3.080506129769992,"k0":1,"x0":350000,"y0":650000,"ellps":"intl","datum_params":[175,-38,113,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5519","projName":"tmerc","lat0":-0.767944870877505,"long0":-3.080506129769992,"k0":1,"x0":350000,"y0":650000,"ellps":"intl","datum_params":[174.05,-25.49,112.57,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"5520","projName":"tmerc","lat0":0,"long0":0.05235987755982989,"k0":1,"x0":1500000,"y0":0,"datumCode":"potsdam","units":"m","no_defs":true},{"EPSG":"5523","projName":"tmerc","lat0":0,"long0":0.2007128639793479,"k0":0.9996,"x0":1500000,"y0":5500000,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"5530","projName":"poly","lat0":0,"long0":-0.9424777960769379,"x0":5000000,"y0":10000000,"ellps":"aust_SA","units":"m","no_defs":true},{"EPSG":"5531","projName":"utm","zone":21,"utmSouth":true,"ellps":"aust_SA","units":"m","no_defs":true},{"EPSG":"5532","projName":"utm","zone":22,"utmSouth":true,"ellps":"aust_SA","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5533","projName":"utm","zone":23,"utmSouth":true,"ellps":"aust_SA","units":"m","no_defs":true},{"EPSG":"5534","projName":"utm","zone":24,"utmSouth":true,"ellps":"aust_SA","units":"m","no_defs":true},{"EPSG":"5535","projName":"utm","zone":25,"utmSouth":true,"ellps":"aust_SA","units":"m","no_defs":true},{"EPSG":"5536","projName":"utm","zone":21,"utmSouth":true,"ellps":"intl","units":"m","no_defs":true},{"EPSG":"5537","projName":"utm","zone":22,"utmSouth":true,"ellps":"intl","units":"m","no_defs":true},{"EPSG":"5538","projName":"utm","zone":23,"utmSouth":true,"ellps":"intl","units":"m","no_defs":true},{"EPSG":"5539","projName":"utm","zone":24,"utmSouth":true,"ellps":"intl","units":"m","no_defs":true},{"EPSG":"5550","projName":"utm","zone":54,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5551","projName":"utm","zone":55,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5552","projName":"utm","zone":56,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5559","projName":"lcc","lat1":0.2935062025437131,"lat0":0.2935062025437131,"long0":-1.576614090968211,"k0":0.99992226,"x0":500000,"y0":292209.579,"ellps":"clrk66","datum_params":[213.11,9.37,-74.95,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5562","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":4500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5563","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":5500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5564","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":6500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5565","projName":"tmerc","lat0":0,"long0":0.6806784082777885,"k0":1,"x0":7500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5566","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5567","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5568","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5569","projName":"tmerc","lat0":0,"long0":0.6806784082777885,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5570","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":7500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5571","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":1,"x0":8500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5572","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":9500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5573","projName":"tmerc","lat0":0,"long0":0.5235987755982988,"k0":1,"x0":10500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5574","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":11500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5575","projName":"tmerc","lat0":0,"long0":0.6283185307179586,"k0":1,"x0":12500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5576","projName":"tmerc","lat0":0,"long0":0.6806784082777885,"k0":1,"x0":13500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5577","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5578","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5579","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5580","projName":"tmerc","lat0":0,"long0":0.5235987755982988,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5581","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5582","projName":"tmerc","lat0":0,"long0":0.6283185307179586,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5583","projName":"tmerc","lat0":0,"long0":0.6806784082777885,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[25,-141,-78.5,0,0.35,0.736,0],"units":"m","no_defs":true},{"EPSG":"5588","projName":"sterea","lat0":0.8115781021773633,"long0":-1.160643952576229,"k0":0.999912,"x0":304800,"y0":304800,"datumCode":"NAD27","units":"ft","no_defs":true},{"EPSG":"5589","projName":"tmerc","lat0":0.297774846409915,"long0":-1.54691773553343,"k0":1,"x0":66220.02833082761,"y0":135779.5099885299,"a":"6378293.645208759","b":"6356617.987679838","to_meter":0.3047972654,"no_defs":true},{"EPSG":"5596","projName":"tmerc","lat0":0,"long0":0.19780398189269063,"k0":1,"x0":1000000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5623","projName":"tmerc","lat0":0.7243116395776468,"long0":-1.4602588075019225,"k0":0.999942857,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"5624","projName":"tmerc","lat0":0.7243116395776468,"long0":-1.4966198335851375,"k0":0.999909091,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"5625","projName":"tmerc","lat0":0.7243116395776468,"long0":-1.5489797111449675,"k0":0.999909091,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"5627","projName":"tmerc","lat0":0,"long0":0.10471975511965978,"k0":0.9996,"x0":500000,"y0":0,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5629","projName":"utm","zone":38,"utmSouth":true,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5631","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":1,"x0":2500000,"y0":0,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"5632","projName":"lcc","lat1":0.6108652381980153,"lat2":1.1344640137963142,"lat0":0.9075712110370514,"long0":0.17453292519943295,"x0":4000000,"y0":2800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5633","projName":"laea","lat0":0.9075712110370514,"long0":0.17453292519943295,"x0":4321000,"y0":3210000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5634","projName":"lcc","lat1":0.6108652381980153,"lat2":1.1344640137963142,"lat0":0.9075712110370514,"long0":0.17453292519943295,"x0":4000000,"y0":2800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5635","projName":"laea","lat0":0.9075712110370514,"long0":0.17453292519943295,"x0":4321000,"y0":3210000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5636","projName":"laea","lat0":0.9075712110370514,"long0":0.17453292519943295,"x0":4321000,"y0":3210000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5637","projName":"lcc","lat1":0.6108652381980153,"lat2":1.1344640137963142,"lat0":0.9075712110370514,"long0":0.17453292519943295,"x0":4000000,"y0":2800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5638","projName":"laea","lat0":0.9075712110370514,"long0":0.17453292519943295,"x0":4321000,"y0":3210000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5639","projName":"lcc","lat1":0.6108652381980153,"lat2":1.1344640137963142,"lat0":0.9075712110370514,"long0":0.17453292519943295,"x0":4000000,"y0":2800000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5641","projName":"merc","long0":-0.7504915783575618,"lat_ts":-0.03490658503988659,"x0":5000000,"y0":10000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5643","projName":"lcc","lat1":0.91920673938368,"lat2":0.9482955602502525,"lat0":0.8377580409572782,"long0":0.17453292519943295,"x0":815000,"y0":0,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5644","projName":"utm","zone":39,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5646","projName":"tmerc","lat0":0.7417649320975901,"long0":-1.265363707695889,"k0":0.999964286,"x0":500000.00001016,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"5649","projName":"tmerc","lat0":0,"long0":0.05235987755982989,"k0":0.9996,"x0":31500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5650","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":0.9996,"x0":33500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5651","projName":"tmerc","lat0":0,"long0":0.05235987755982989,"k0":0.9996,"x0":31500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5652","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":0.9996,"x0":32500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5653","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":0.9996,"x0":33500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5654","projName":"tmerc","lat0":0.7417649320975901,"long0":-1.265363707695889,"k0":0.999964286,"x0":500000.00001016,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"5655","projName":"tmerc","lat0":0.7417649320975901,"long0":-1.265363707695889,"k0":0.999964286,"x0":500000.00001016,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"5659","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":0.9996,"x0":500053,"y0":-3999820,"ellps":"intl","datum_params":[-104.1,-49.1,-9.9,0.971,-2.917,0.714,-11.68],"units":"m","no_defs":true},{"EPSG":"5663","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":3500000,"y0":0,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"5664","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":1,"x0":2500000,"y0":0,"ellps":"krass","datum_params":[26,-121,-78,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5665","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":3500000,"y0":0,"ellps":"krass","datum_params":[26,-121,-78,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5666","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":1,"x0":3500000,"y0":0,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"5667","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":1,"x0":4500000,"y0":0,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"5668","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":1,"x0":4500000,"y0":0,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"5669","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":5500000,"y0":0,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"5670","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":1,"x0":3500000,"y0":0,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"5671","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":1,"x0":4500000,"y0":0,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"5672","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":5500000,"y0":0,"ellps":"krass","datum_params":[33.4,-146.6,-76.3,-0.359,-0.053,0.844,-0.84],"units":"m","no_defs":true},{"EPSG":"5673","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":1,"x0":3500000,"y0":0,"ellps":"krass","datum_params":[26,-121,-78,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5674","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":1,"x0":4500000,"y0":0,"ellps":"krass","datum_params":[26,-121,-78,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5675","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":5500000,"y0":0,"ellps":"krass","datum_params":[26,-121,-78,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5676","projName":"tmerc","lat0":0,"long0":0.10471975511965978,"k0":1,"x0":2500000,"y0":0,"datumCode":"potsdam","units":"m","no_defs":true},{"EPSG":"5677","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":1,"x0":3500000,"y0":0,"datumCode":"potsdam","units":"m","no_defs":true},{"EPSG":"5678","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":1,"x0":4500000,"y0":0,"datumCode":"potsdam","units":"m","no_defs":true},{"EPSG":"5679","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":5500000,"y0":0,"datumCode":"potsdam","units":"m","no_defs":true},{"EPSG":"5680","projName":"tmerc","lat0":0,"long0":0.05235987755982989,"k0":1,"x0":1500000,"y0":0,"datumCode":"potsdam","units":"m","no_defs":true},{"EPSG":"5682","projName":"tmerc","lat0":0,"long0":0.10471975511965978,"k0":1,"x0":2500000,"y0":0,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"5683","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":1,"x0":3500000,"y0":0,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"5684","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":1,"x0":4500000,"y0":0,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"5685","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":5500000,"y0":0,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"5700","projName":"utm","zone":1,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5825","projName":"tmerc","lat0":-0.616410782398269,"long0":2.6007028108681594,"k0":1.000086,"x0":200000,"y0":600000,"ellps":"aust_SA","datum_params":[-117.808,-51.536,137.784,0.303,0.446,0.234,-0.29],"units":"m","no_defs":true},{"EPSG":"5836","projName":"utm","zone":37,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5837","projName":"utm","zone":40,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5839","projName":"utm","zone":17,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5842","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":0.9996,"x0":500000,"y0":10000000,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"5844","projName":"tmerc","lat0":0,"long0":0.5235987755982988,"k0":0.9999,"x0":500000,"y0":10000000,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"5858","projName":"utm","zone":22,"utmSouth":true,"ellps":"aust_SA","units":"m","no_defs":true},{"EPSG":"20004","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":4500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20005","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":5500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20006","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":6500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20007","projName":"tmerc","lat0":0,"long0":0.6806784082777885,"k0":1,"x0":7500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20008","projName":"tmerc","lat0":0,"long0":0.7853981633974483,"k0":1,"x0":8500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20009","projName":"tmerc","lat0":0,"long0":0.8901179185171081,"k0":1,"x0":9500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20010","projName":"tmerc","lat0":0,"long0":0.9948376736367679,"k0":1,"x0":10500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20011","projName":"tmerc","lat0":0,"long0":1.0995574287564276,"k0":1,"x0":11500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20012","projName":"tmerc","lat0":0,"long0":1.2042771838760873,"k0":1,"x0":12500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20013","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":13500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20014","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":14500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20015","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":15500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20016","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":16500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20017","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":17500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20018","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":18500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20019","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":19500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20020","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":20500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20021","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":21500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20022","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":22500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20023","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":23500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20024","projName":"tmerc","lat0":0,"long0":2.4609142453120048,"k0":1,"x0":24500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20025","projName":"tmerc","lat0":0,"long0":2.5656340004316642,"k0":1,"x0":25500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20026","projName":"tmerc","lat0":0,"long0":2.670353755551324,"k0":1,"x0":26500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20027","projName":"tmerc","lat0":0,"long0":2.775073510670984,"k0":1,"x0":27500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20028","projName":"tmerc","lat0":0,"long0":2.8797932657906435,"k0":1,"x0":28500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20029","projName":"tmerc","lat0":0,"long0":2.9845130209103035,"k0":1,"x0":29500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20030","projName":"tmerc","lat0":0,"long0":3.0892327760299634,"k0":1,"x0":30500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20031","projName":"tmerc","lat0":0,"long0":-3.0892327760299634,"k0":1,"x0":31500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20032","projName":"tmerc","lat0":0,"long0":-2.9845130209103035,"k0":1,"x0":32500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20064","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20065","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20066","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20067","projName":"tmerc","lat0":0,"long0":0.6806784082777885,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20068","projName":"tmerc","lat0":0,"long0":0.7853981633974483,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20069","projName":"tmerc","lat0":0,"long0":0.8901179185171081,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20070","projName":"tmerc","lat0":0,"long0":0.9948376736367679,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20071","projName":"tmerc","lat0":0,"long0":1.0995574287564276,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20072","projName":"tmerc","lat0":0,"long0":1.2042771838760873,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20073","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20074","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20075","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20076","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20077","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20078","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20079","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20080","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20081","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20082","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20083","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20084","projName":"tmerc","lat0":0,"long0":2.4609142453120048,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20085","projName":"tmerc","lat0":0,"long0":2.5656340004316642,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20086","projName":"tmerc","lat0":0,"long0":2.670353755551324,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20087","projName":"tmerc","lat0":0,"long0":2.775073510670984,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20088","projName":"tmerc","lat0":0,"long0":2.8797932657906435,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20089","projName":"tmerc","lat0":0,"long0":2.9845130209103035,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20090","projName":"tmerc","lat0":0,"long0":3.0892327760299634,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20091","projName":"tmerc","lat0":0,"long0":-3.0892327760299634,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20092","projName":"tmerc","lat0":0,"long0":-2.9845130209103035,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[24.47,-130.89,-81.56,0,0,0.13,-0.22],"units":"m","no_defs":true},{"EPSG":"20135","projName":"utm","zone":35,"ellps":"clrk80","datum_params":[-166,-15,204,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20136","projName":"utm","zone":36,"ellps":"clrk80","datum_params":[-166,-15,204,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20137","projName":"utm","zone":37,"ellps":"clrk80","datum_params":[-166,-15,204,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20138","projName":"utm","zone":38,"ellps":"clrk80","datum_params":[-166,-15,204,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20248","projName":"utm","zone":48,"utmSouth":true,"ellps":"aust_SA","datum_params":[-117.808,-51.536,137.784,0.303,0.446,0.234,-0.29],"units":"m","no_defs":true},{"EPSG":"20249","projName":"utm","zone":49,"utmSouth":true,"ellps":"aust_SA","datum_params":[-117.808,-51.536,137.784,0.303,0.446,0.234,-0.29],"units":"m","no_defs":true},{"EPSG":"20250","projName":"utm","zone":50,"utmSouth":true,"ellps":"aust_SA","datum_params":[-117.808,-51.536,137.784,0.303,0.446,0.234,-0.29],"units":"m","no_defs":true},{"EPSG":"20251","projName":"utm","zone":51,"utmSouth":true,"ellps":"aust_SA","datum_params":[-117.808,-51.536,137.784,0.303,0.446,0.234,-0.29],"units":"m","no_defs":true},{"EPSG":"20252","projName":"utm","zone":52,"utmSouth":true,"ellps":"aust_SA","datum_params":[-117.808,-51.536,137.784,0.303,0.446,0.234,-0.29],"units":"m","no_defs":true},{"EPSG":"20253","projName":"utm","zone":53,"utmSouth":true,"ellps":"aust_SA","datum_params":[-117.808,-51.536,137.784,0.303,0.446,0.234,-0.29],"units":"m","no_defs":true},{"EPSG":"20254","projName":"utm","zone":54,"utmSouth":true,"ellps":"aust_SA","datum_params":[-117.808,-51.536,137.784,0.303,0.446,0.234,-0.29],"units":"m","no_defs":true},{"EPSG":"20255","projName":"utm","zone":55,"utmSouth":true,"ellps":"aust_SA","datum_params":[-117.808,-51.536,137.784,0.303,0.446,0.234,-0.29],"units":"m","no_defs":true},{"EPSG":"20256","projName":"utm","zone":56,"utmSouth":true,"ellps":"aust_SA","datum_params":[-117.808,-51.536,137.784,0.303,0.446,0.234,-0.29],"units":"m","no_defs":true},{"EPSG":"20257","projName":"utm","zone":57,"utmSouth":true,"ellps":"aust_SA","datum_params":[-117.808,-51.536,137.784,0.303,0.446,0.234,-0.29],"units":"m","no_defs":true},{"EPSG":"20258","projName":"utm","zone":58,"utmSouth":true,"ellps":"aust_SA","datum_params":[-117.808,-51.536,137.784,0.303,0.446,0.234,-0.29],"units":"m","no_defs":true},{"EPSG":"20348","projName":"utm","zone":48,"utmSouth":true,"ellps":"aust_SA","datum_params":[-134,-48,149,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20349","projName":"utm","zone":49,"utmSouth":true,"ellps":"aust_SA","datum_params":[-134,-48,149,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20350","projName":"utm","zone":50,"utmSouth":true,"ellps":"aust_SA","datum_params":[-134,-48,149,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20351","projName":"utm","zone":51,"utmSouth":true,"ellps":"aust_SA","datum_params":[-134,-48,149,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20352","projName":"utm","zone":52,"utmSouth":true,"ellps":"aust_SA","datum_params":[-134,-48,149,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20353","projName":"utm","zone":53,"utmSouth":true,"ellps":"aust_SA","datum_params":[-134,-48,149,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20354","projName":"utm","zone":54,"utmSouth":true,"ellps":"aust_SA","datum_params":[-134,-48,149,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20355","projName":"utm","zone":55,"utmSouth":true,"ellps":"aust_SA","datum_params":[-134,-48,149,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20356","projName":"utm","zone":56,"utmSouth":true,"ellps":"aust_SA","datum_params":[-134,-48,149,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20357","projName":"utm","zone":57,"utmSouth":true,"ellps":"aust_SA","datum_params":[-134,-48,149,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20358","projName":"utm","zone":58,"utmSouth":true,"ellps":"aust_SA","datum_params":[-134,-48,149,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20436","projName":"utm","zone":36,"ellps":"intl","datum_params":[-143,-236,7,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20437","projName":"utm","zone":37,"ellps":"intl","datum_params":[-143,-236,7,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20438","projName":"utm","zone":38,"ellps":"intl","datum_params":[-143,-236,7,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20439","projName":"utm","zone":39,"ellps":"intl","datum_params":[-143,-236,7,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20440","projName":"utm","zone":40,"ellps":"intl","datum_params":[-143,-236,7,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20499","projName":"utm","zone":39,"ellps":"intl","datum_params":[-143,-236,7,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20538","projName":"utm","zone":38,"ellps":"krass","datum_params":[-43,-163,45,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20539","projName":"utm","zone":39,"ellps":"krass","datum_params":[-43,-163,45,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20790","projName":"tmerc","lat0":0.6923139366244172,"long0":0.017453292519943295,"k0":1,"x0":200000,"y0":300000,"ellps":"intl","datum_params":[-304.046,-60.576,103.64,0,0,0,0],"from_greenwich":-0.15938182862187808,"units":"m","no_defs":true},{"EPSG":"20791","projName":"tmerc","lat0":0.6923139366244172,"long0":0.017453292519943295,"k0":1,"x0":0,"y0":0,"ellps":"intl","datum_params":[-304.046,-60.576,103.64,0,0,0,0],"from_greenwich":-0.15938182862187808,"units":"m","no_defs":true},{"EPSG":"20822","projName":"utm","zone":22,"utmSouth":true,"ellps":"intl","datum_params":[-151.99,287.04,-147.45,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20823","projName":"utm","zone":23,"utmSouth":true,"ellps":"intl","datum_params":[-151.99,287.04,-147.45,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20824","projName":"utm","zone":24,"utmSouth":true,"ellps":"intl","datum_params":[-151.99,287.04,-147.45,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20934","projName":"utm","zone":34,"utmSouth":true,"a":"6378249.145","b":"6356514.966398753","datum_params":[-143,-90,-294,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20935","projName":"utm","zone":35,"utmSouth":true,"a":"6378249.145","b":"6356514.966398753","datum_params":[-143,-90,-294,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"20936","projName":"utm","zone":36,"utmSouth":true,"a":"6378249.145","b":"6356514.966398753","datum_params":[-143,-90,-294,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21035","projName":"utm","zone":35,"utmSouth":true,"ellps":"clrk80","datum_params":[-160,-6,-302,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21036","projName":"utm","zone":36,"utmSouth":true,"ellps":"clrk80","datum_params":[-160,-6,-302,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21037","projName":"utm","zone":37,"utmSouth":true,"ellps":"clrk80","datum_params":[-160,-6,-302,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21095","projName":"utm","zone":35,"ellps":"clrk80","datum_params":[-160,-6,-302,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21096","projName":"utm","zone":36,"ellps":"clrk80","datum_params":[-160,-6,-302,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21097","projName":"utm","zone":37,"ellps":"clrk80","datum_params":[-160,-6,-302,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21100","projName":"merc","long0":1.9198621771937625,"k0":0.997,"x0":3900000,"y0":900000,"ellps":"bessel","datum_params":[-377,681,-50,0,0,0,0],"from_greenwich":1.8641463708519166,"units":"m","no_defs":true},{"EPSG":"21148","projName":"utm","zone":48,"utmSouth":true,"ellps":"bessel","datum_params":[-377,681,-50,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21149","projName":"utm","zone":49,"utmSouth":true,"ellps":"bessel","datum_params":[-377,681,-50,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21150","projName":"utm","zone":50,"utmSouth":true,"ellps":"bessel","datum_params":[-377,681,-50,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21291","projName":"tmerc","lat0":0,"long0":-1.0821041362364843,"k0":0.9995,"x0":400000,"y0":0,"ellps":"clrk80","datum_params":[31.95,300.99,419.19,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21292","projName":"tmerc","lat0":0.22997136963430842,"long0":-1.0395132543510115,"k0":0.9999986,"x0":30000,"y0":75000,"ellps":"clrk80","datum_params":[31.95,300.99,419.19,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21413","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":13500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21414","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":14500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21415","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":15500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21416","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":16500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21417","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":17500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21418","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":18500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21419","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":19500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21420","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":20500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21421","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":21500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21422","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":22500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21423","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":23500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21453","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21454","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21455","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21456","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21457","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21458","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21459","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21460","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21461","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21462","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21463","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21473","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21474","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21475","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21476","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21477","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21478","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21479","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21480","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21481","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21482","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21483","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[15.8,-154.4,-82.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21500","projName":"lcc","lat1":0.8697557439105077,"lat2":0.8930268006037652,"lat0":1.5707963267948966,"long0":0,"x0":150000,"y0":5400000,"ellps":"intl","from_greenwich":0.07623554539479932,"units":"m","no_defs":true},{"EPSG":"21780","projName":"somerc","lat0":0.8194740686761218,"long0":0,"k0":1,"x0":0,"y0":0,"ellps":"bessel","datum_params":[674.4,15.1,405.3,0,0,0,0],"from_greenwich":0.12984522414315566,"units":"m","no_defs":true},{"EPSG":"21781","projName":"somerc","lat0":0.8194740686761218,"long0":0.12984522414316146,"k0":1,"x0":600000,"y0":200000,"ellps":"bessel","datum_params":[674.4,15.1,405.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21782","projName":"somerc","lat0":0.8194740686761218,"long0":0.12984522414316146,"k0":1,"x0":0,"y0":0,"ellps":"bessel","datum_params":[674.4,15.1,405.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21817","projName":"utm","zone":17,"ellps":"intl","datum_params":[307,304,-318,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21818","projName":"utm","zone":18,"ellps":"intl","datum_params":[307,304,-318,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21891","projName":"tmerc","lat0":0.0802685164824771,"long0":-1.3453157862887057,"k0":1,"x0":1000000,"y0":1000000,"ellps":"intl","datum_params":[307,304,-318,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21892","projName":"tmerc","lat0":0.0802685164824771,"long0":-1.292955908728876,"k0":1,"x0":1000000,"y0":1000000,"ellps":"intl","datum_params":[307,304,-318,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21893","projName":"tmerc","lat0":0.0802685164824771,"long0":-1.240596031169046,"k0":1,"x0":1000000,"y0":1000000,"ellps":"intl","datum_params":[307,304,-318,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21894","projName":"tmerc","lat0":0.0802685164824771,"long0":-1.188236153609216,"k0":1,"x0":1000000,"y0":1000000,"ellps":"intl","datum_params":[307,304,-318,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21896","projName":"tmerc","lat0":0.0802685164824771,"long0":-1.3453157862887057,"k0":1,"x0":1000000,"y0":1000000,"ellps":"intl","datum_params":[307,304,-318,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21897","projName":"tmerc","lat0":0.0802685164824771,"long0":-1.292955908728876,"k0":1,"x0":1000000,"y0":1000000,"ellps":"intl","datum_params":[307,304,-318,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21898","projName":"tmerc","lat0":0.0802685164824771,"long0":-1.240596031169046,"k0":1,"x0":1000000,"y0":1000000,"ellps":"intl","datum_params":[307,304,-318,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"21899","projName":"tmerc","lat0":0.0802685164824771,"long0":-1.188236153609216,"k0":1,"x0":1000000,"y0":1000000,"ellps":"intl","datum_params":[307,304,-318,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22032","projName":"utm","zone":32,"utmSouth":true,"ellps":"clrk80","datum_params":[-50.9,-347.6,-231,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22033","projName":"utm","zone":33,"utmSouth":true,"ellps":"clrk80","datum_params":[-50.9,-347.6,-231,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22091","projName":"tmerc","lat0":0,"long0":0.2007128639793479,"k0":0.9996,"x0":500000,"y0":10000000,"ellps":"clrk80","datum_params":[-50.9,-347.6,-231,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22092","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":0.9996,"x0":500000,"y0":10000000,"ellps":"clrk80","datum_params":[-50.9,-347.6,-231,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22171","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.2566370614359172,"k0":1,"x0":1500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22172","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.2042771838760873,"k0":1,"x0":2500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22173","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.1519173063162575,"k0":1,"x0":3500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22174","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.0995574287564276,"k0":1,"x0":4500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22175","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.0471975511965976,"k0":1,"x0":5500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22176","projName":"tmerc","lat0":-1.5707963267948966,"long0":-0.9948376736367679,"k0":1,"x0":6500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22177","projName":"tmerc","lat0":-1.5707963267948966,"long0":-0.9424777960769379,"k0":1,"x0":7500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22181","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.2566370614359172,"k0":1,"x0":1500000,"y0":0,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22182","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.2042771838760873,"k0":1,"x0":2500000,"y0":0,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22183","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.1519173063162575,"k0":1,"x0":3500000,"y0":0,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22184","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.0995574287564276,"k0":1,"x0":4500000,"y0":0,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22185","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.0471975511965976,"k0":1,"x0":5500000,"y0":0,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22186","projName":"tmerc","lat0":-1.5707963267948966,"long0":-0.9948376736367679,"k0":1,"x0":6500000,"y0":0,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22187","projName":"tmerc","lat0":-1.5707963267948966,"long0":-0.9424777960769379,"k0":1,"x0":7500000,"y0":0,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22191","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.2566370614359172,"k0":1,"x0":1500000,"y0":0,"ellps":"intl","datum_params":[-148,136,90,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22192","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.2042771838760873,"k0":1,"x0":2500000,"y0":0,"ellps":"intl","datum_params":[-148,136,90,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22193","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.1519173063162575,"k0":1,"x0":3500000,"y0":0,"ellps":"intl","datum_params":[-148,136,90,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22194","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.0995574287564276,"k0":1,"x0":4500000,"y0":0,"ellps":"intl","datum_params":[-148,136,90,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22195","projName":"tmerc","lat0":-1.5707963267948966,"long0":-1.0471975511965976,"k0":1,"x0":5500000,"y0":0,"ellps":"intl","datum_params":[-148,136,90,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22196","projName":"tmerc","lat0":-1.5707963267948966,"long0":-0.9948376736367679,"k0":1,"x0":6500000,"y0":0,"ellps":"intl","datum_params":[-148,136,90,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22197","projName":"tmerc","lat0":-1.5707963267948966,"long0":-0.9424777960769379,"k0":1,"x0":7500000,"y0":0,"ellps":"intl","datum_params":[-148,136,90,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22234","projName":"utm","zone":34,"utmSouth":true,"a":"6378249.145","b":"6356514.966398753","datum_params":[-136,-108,-292,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22235","projName":"utm","zone":35,"utmSouth":true,"a":"6378249.145","b":"6356514.966398753","datum_params":[-136,-108,-292,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22236","projName":"utm","zone":36,"utmSouth":true,"a":"6378249.145","b":"6356514.966398753","datum_params":[-136,-108,-292,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22275","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":0,"y0":0,"axis":"wsu","a":"6378249.145","b":"6356514.966398753","datum_params":[-136,-108,-292,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22277","projName":"tmerc","lat0":0,"long0":0.29670597283903605,"k0":1,"x0":0,"y0":0,"axis":"wsu","a":"6378249.145","b":"6356514.966398753","datum_params":[-136,-108,-292,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22279","projName":"tmerc","lat0":0,"long0":0.33161255787892263,"k0":1,"x0":0,"y0":0,"axis":"wsu","a":"6378249.145","b":"6356514.966398753","datum_params":[-136,-108,-292,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22281","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":0,"y0":0,"axis":"wsu","a":"6378249.145","b":"6356514.966398753","datum_params":[-136,-108,-292,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22283","projName":"tmerc","lat0":0,"long0":0.4014257279586958,"k0":1,"x0":0,"y0":0,"axis":"wsu","a":"6378249.145","b":"6356514.966398753","datum_params":[-136,-108,-292,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22285","projName":"tmerc","lat0":0,"long0":0.4363323129985824,"k0":1,"x0":0,"y0":0,"axis":"wsu","a":"6378249.145","b":"6356514.966398753","datum_params":[-136,-108,-292,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22287","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":0,"y0":0,"axis":"wsu","a":"6378249.145","b":"6356514.966398753","datum_params":[-136,-108,-292,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22289","projName":"tmerc","lat0":0,"long0":0.5061454830783556,"k0":1,"x0":0,"y0":0,"axis":"wsu","a":"6378249.145","b":"6356514.966398753","datum_params":[-136,-108,-292,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22291","projName":"tmerc","lat0":0,"long0":0.5410520681182421,"k0":1,"x0":0,"y0":0,"axis":"wsu","a":"6378249.145","b":"6356514.966398753","datum_params":[-136,-108,-292,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22293","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":0,"y0":0,"axis":"wsu","a":"6378249.145","b":"6356514.966398753","datum_params":[-136,-108,-292,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22332","projName":"utm","zone":32,"datumCode":"carthage","units":"m","no_defs":true},{"EPSG":"22391","projName":"lcc","lat1":0.6283185307179586,"lat0":0.6283185307179586,"long0":0.17278759594743864,"k0":0.999625544,"x0":500000,"y0":300000,"datumCode":"carthage","units":"m","no_defs":true},{"EPSG":"22392","projName":"lcc","lat1":0.5811946409141117,"lat0":0.5811946409141117,"long0":0.17278759594743864,"k0":0.999625769,"x0":500000,"y0":300000,"datumCode":"carthage","units":"m","no_defs":true},{"EPSG":"22521","projName":"utm","zone":21,"utmSouth":true,"ellps":"intl","datum_params":[-206,172,-6,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22522","projName":"utm","zone":22,"utmSouth":true,"ellps":"intl","datum_params":[-206,172,-6,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22523","projName":"utm","zone":23,"utmSouth":true,"ellps":"intl","datum_params":[-206,172,-6,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22524","projName":"utm","zone":24,"utmSouth":true,"ellps":"intl","datum_params":[-206,172,-6,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22525","projName":"utm","zone":25,"utmSouth":true,"ellps":"intl","datum_params":[-206,172,-6,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22700","projName":"lcc","lat1":0.6047565858160352,"lat0":0.6047565858160352,"long0":0.6518804756198822,"k0":0.9996256,"x0":300000,"y0":300000,"a":"6378249.2","b":"6356515","datum_params":[-190.421,8.532,238.69,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22770","projName":"lcc","lat1":0.6047565858160352,"lat0":0.6047565858160352,"long0":0.6518804756198822,"k0":0.9996256,"x0":300000,"y0":300000,"a":"6378249.2","b":"6356515","datum_params":[-190.421,8.532,238.69,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22780","projName":"sterea","lat0":0.5969026041820608,"long0":0.68329640215578,"k0":0.9995341,"x0":0,"y0":0,"a":"6378249.2","b":"6356515","datum_params":[-190.421,8.532,238.69,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22832","projName":"utm","zone":32,"a":"6378249.2","b":"6356515","units":"m","no_defs":true},{"EPSG":"22991","projName":"tmerc","lat0":0.5235987755982988,"long0":0.6108652381980153,"k0":1,"x0":300000,"y0":1100000,"ellps":"helmert","datum_params":[-130,110,-13,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22992","projName":"tmerc","lat0":0.5235987755982988,"long0":0.5410520681182421,"k0":1,"x0":615000,"y0":810000,"ellps":"helmert","datum_params":[-130,110,-13,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22993","projName":"tmerc","lat0":0.5235987755982988,"long0":0.47123889803846897,"k0":1,"x0":700000,"y0":200000,"ellps":"helmert","datum_params":[-130,110,-13,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"22994","projName":"tmerc","lat0":0.5235987755982988,"long0":0.47123889803846897,"k0":1,"x0":700000,"y0":1200000,"ellps":"helmert","datum_params":[-130,110,-13,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23028","projName":"utm","zone":28,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23029","projName":"utm","zone":29,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23030","projName":"utm","zone":30,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23031","projName":"utm","zone":31,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23032","projName":"utm","zone":32,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23033","projName":"utm","zone":33,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23034","projName":"utm","zone":34,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23035","projName":"utm","zone":35,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23036","projName":"utm","zone":36,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23037","projName":"utm","zone":37,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23038","projName":"utm","zone":38,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23090","projName":"tmerc","lat0":0,"long0":0,"k0":0.9996,"x0":500000,"y0":0,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23095","projName":"tmerc","lat0":0,"long0":0.08726646259971647,"k0":0.9996,"x0":500000,"y0":0,"ellps":"intl","datum_params":[-87,-98,-121,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23239","projName":"utm","zone":39,"ellps":"clrk80","datum_params":[-346,-1,224,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23240","projName":"utm","zone":40,"ellps":"clrk80","datum_params":[-346,-1,224,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23433","projName":"utm","zone":33,"a":"6378249.2","b":"6356515","units":"m","no_defs":true},{"EPSG":"23700","projName":"somerc","lat0":0.8228248943093227,"long0":0.3324602953246919,"k0":0.99993,"x0":650000,"y0":200000,"ellps":"GRS67","datum_params":[52.17,-71.82,-14.9,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23830","projName":"tmerc","lat0":0,"long0":1.6493361431346414,"k0":0.9999,"x0":200000,"y0":1500000,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23831","projName":"tmerc","lat0":0,"long0":1.7016960206944713,"k0":0.9999,"x0":200000,"y0":1500000,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23832","projName":"tmerc","lat0":0,"long0":1.7540558982543013,"k0":0.9999,"x0":200000,"y0":1500000,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23833","projName":"tmerc","lat0":0,"long0":1.806415775814131,"k0":0.9999,"x0":200000,"y0":1500000,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23834","projName":"tmerc","lat0":0,"long0":1.858775653373961,"k0":0.9999,"x0":200000,"y0":1500000,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23835","projName":"tmerc","lat0":0,"long0":1.911135530933791,"k0":0.9999,"x0":200000,"y0":1500000,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23836","projName":"tmerc","lat0":0,"long0":1.9634954084936207,"k0":0.9999,"x0":200000,"y0":1500000,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23837","projName":"tmerc","lat0":0,"long0":2.0158552860534504,"k0":0.9999,"x0":200000,"y0":1500000,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23838","projName":"tmerc","lat0":0,"long0":2.0682151636132806,"k0":0.9999,"x0":200000,"y0":1500000,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23839","projName":"tmerc","lat0":0,"long0":2.1205750411731104,"k0":0.9999,"x0":200000,"y0":1500000,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23840","projName":"tmerc","lat0":0,"long0":2.17293491873294,"k0":0.9999,"x0":200000,"y0":1500000,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23841","projName":"tmerc","lat0":0,"long0":2.2252947962927703,"k0":0.9999,"x0":200000,"y0":1500000,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23842","projName":"tmerc","lat0":0,"long0":2.2776546738526,"k0":0.9999,"x0":200000,"y0":1500000,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23843","projName":"tmerc","lat0":0,"long0":2.3300145514124297,"k0":0.9999,"x0":200000,"y0":1500000,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23844","projName":"tmerc","lat0":0,"long0":2.38237442897226,"k0":0.9999,"x0":200000,"y0":1500000,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23845","projName":"tmerc","lat0":0,"long0":2.4347343065320897,"k0":0.9999,"x0":200000,"y0":1500000,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23846","projName":"utm","zone":46,"a":"6378160","b":"6356774.50408554","datum_params":[-24,-15,5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23847","projName":"utm","zone":47,"a":"6378160","b":"6356774.50408554","datum_params":[-24,-15,5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23848","projName":"utm","zone":48,"a":"6378160","b":"6356774.50408554","datum_params":[-24,-15,5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23849","projName":"utm","zone":49,"a":"6378160","b":"6356774.50408554","datum_params":[-24,-15,5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23850","projName":"utm","zone":50,"a":"6378160","b":"6356774.50408554","datum_params":[-24,-15,5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23851","projName":"utm","zone":51,"a":"6378160","b":"6356774.50408554","datum_params":[-24,-15,5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23852","projName":"utm","zone":52,"a":"6378160","b":"6356774.50408554","datum_params":[-24,-15,5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23853","projName":"utm","zone":53,"a":"6378160","b":"6356774.50408554","datum_params":[-24,-15,5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23866","projName":"utm","zone":46,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23867","projName":"utm","zone":47,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23868","projName":"utm","zone":48,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23869","projName":"utm","zone":49,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23870","projName":"utm","zone":50,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23871","projName":"utm","zone":51,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23872","projName":"utm","zone":52,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23877","projName":"utm","zone":47,"utmSouth":true,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23878","projName":"utm","zone":48,"utmSouth":true,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23879","projName":"utm","zone":49,"utmSouth":true,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23880","projName":"utm","zone":50,"utmSouth":true,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23881","projName":"utm","zone":51,"utmSouth":true,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23882","projName":"utm","zone":52,"utmSouth":true,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23883","projName":"utm","zone":53,"utmSouth":true,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23884","projName":"utm","zone":54,"utmSouth":true,"ellps":"WGS84","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23886","projName":"utm","zone":46,"utmSouth":true,"a":"6378160","b":"6356774.50408554","datum_params":[-24,-15,5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23887","projName":"utm","zone":47,"utmSouth":true,"a":"6378160","b":"6356774.50408554","datum_params":[-24,-15,5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23888","projName":"utm","zone":48,"utmSouth":true,"a":"6378160","b":"6356774.50408554","datum_params":[-24,-15,5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23889","projName":"utm","zone":49,"utmSouth":true,"a":"6378160","b":"6356774.50408554","datum_params":[-24,-15,5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23890","projName":"utm","zone":50,"utmSouth":true,"a":"6378160","b":"6356774.50408554","datum_params":[-24,-15,5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23891","projName":"utm","zone":51,"utmSouth":true,"a":"6378160","b":"6356774.50408554","datum_params":[-24,-15,5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23892","projName":"utm","zone":52,"utmSouth":true,"a":"6378160","b":"6356774.50408554","datum_params":[-24,-15,5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23893","projName":"utm","zone":53,"utmSouth":true,"a":"6378160","b":"6356774.50408554","datum_params":[-24,-15,5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23894","projName":"utm","zone":54,"utmSouth":true,"a":"6378160","b":"6356774.50408554","datum_params":[-24,-15,5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23946","projName":"utm","zone":46,"a":"6377276.345","b":"6356075.41314024","datum_params":[217,823,299,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23947","projName":"utm","zone":47,"a":"6377276.345","b":"6356075.41314024","datum_params":[217,823,299,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"23948","projName":"utm","zone":48,"a":"6377276.345","b":"6356075.41314024","datum_params":[217,823,299,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24047","projName":"utm","zone":47,"a":"6377276.345","b":"6356075.41314024","datum_params":[210,814,289,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24048","projName":"utm","zone":48,"a":"6377276.345","b":"6356075.41314024","datum_params":[210,814,289,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24100","projName":"lcc","lat1":0.3141592653589793,"lat0":0.3141592653589793,"long0":-1.3439035240356338,"k0":1,"x0":167638.49597,"y0":121918.90616,"a":"6378249.144808011","b":"6356514.966204134","to_meter":0.3047972654,"no_defs":true},{"EPSG":"24200","projName":"lcc","lat1":0.3141592653589793,"lat0":0.3141592653589793,"long0":-1.3439035240356338,"k0":1,"x0":250000,"y0":150000,"ellps":"clrk66","datum_params":[70,207,389.5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24305","projName":"utm","zone":45,"a":"6377276.345","b":"6356075.41314024","datum_params":[214,804,268,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24306","projName":"utm","zone":46,"a":"6377276.345","b":"6356075.41314024","datum_params":[214,804,268,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24311","projName":"utm","zone":41,"a":"6377301.243","b":"6356100.230165384","datum_params":[283,682,231,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24312","projName":"utm","zone":42,"a":"6377301.243","b":"6356100.230165384","datum_params":[283,682,231,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24313","projName":"utm","zone":43,"a":"6377301.243","b":"6356100.230165384","datum_params":[283,682,231,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24342","projName":"utm","zone":42,"a":"6377299.151","b":"6356098.145120132","datum_params":[295,736,257,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24343","projName":"utm","zone":43,"a":"6377299.151","b":"6356098.145120132","datum_params":[295,736,257,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24344","projName":"utm","zone":44,"a":"6377299.151","b":"6356098.145120132","datum_params":[295,736,257,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24345","projName":"utm","zone":45,"a":"6377299.151","b":"6356098.145120132","datum_params":[295,736,257,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24346","projName":"utm","zone":46,"a":"6377299.151","b":"6356098.145120132","datum_params":[295,736,257,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24347","projName":"utm","zone":47,"a":"6377299.151","b":"6356098.145120132","datum_params":[295,736,257,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24370","projName":"lcc","lat1":0.6894050545377601,"lat0":0.6894050545377601,"long0":1.1868238913561442,"k0":0.99846154,"x0":2153865.73916853,"y0":2368292.194628102,"a":"6377299.36559538","b":"6356098.359005156","to_meter":0.9143985307444408,"no_defs":true},{"EPSG":"24371","projName":"lcc","lat1":0.5672320068981571,"lat0":0.5672320068981571,"long0":1.1868238913561442,"k0":0.99878641,"x0":2743195.592233322,"y0":914398.5307444407,"a":"6377299.36559538","b":"6356098.359005156","to_meter":0.9143985307444408,"no_defs":true},{"EPSG":"24372","projName":"lcc","lat1":0.4537856055185257,"lat0":0.4537856055185257,"long0":1.2915436464758039,"k0":0.99878641,"x0":2743195.592233322,"y0":914398.5307444407,"a":"6377299.36559538","b":"6356098.359005156","to_meter":0.9143985307444408,"no_defs":true},{"EPSG":"24373","projName":"lcc","lat1":0.33161255787892263,"lat0":0.33161255787892263,"long0":1.3962634015954636,"k0":0.99878641,"x0":2743195.592233322,"y0":914398.5307444407,"a":"6377299.36559538","b":"6356098.359005156","to_meter":0.9143985307444408,"no_defs":true},{"EPSG":"24374","projName":"lcc","lat1":0.20943951023931956,"lat0":0.20943951023931956,"long0":1.3962634015954636,"k0":0.99878641,"x0":2743195.592233322,"y0":914398.5307444407,"a":"6377299.36559538","b":"6356098.359005156","to_meter":0.9143985307444408,"no_defs":true},{"EPSG":"24375","projName":"lcc","lat1":0.4537856055185257,"lat0":0.4537856055185257,"long0":1.5707963267948966,"k0":0.99878641,"x0":2743185.69,"y0":914395.23,"a":"6377276.345","b":"6356075.41314024","datum_params":[214,804,268,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24376","projName":"lcc","lat1":0.5672320068981571,"lat0":0.5672320068981571,"long0":1.1868238913561442,"k0":0.99878641,"x0":2743196.4,"y0":914398.8,"a":"6377301.243","b":"6356100.230165384","datum_params":[283,682,231,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24377","projName":"lcc","lat1":0.4537856055185257,"lat0":0.4537856055185257,"long0":1.2915436464758039,"k0":0.99878641,"x0":2743196.4,"y0":914398.8,"a":"6377301.243","b":"6356100.230165384","datum_params":[283,682,231,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24378","projName":"lcc","lat1":0.5672320068981571,"lat0":0.5672320068981571,"long0":1.1868238913561442,"k0":0.99878641,"x0":2743195.5,"y0":914398.5,"a":"6377299.151","b":"6356098.145120132","datum_params":[295,736,257,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24379","projName":"lcc","lat1":0.4537856055185257,"lat0":0.4537856055185257,"long0":1.2915436464758039,"k0":0.99878641,"x0":2743195.5,"y0":914398.5,"a":"6377299.151","b":"6356098.145120132","datum_params":[295,736,257,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24380","projName":"lcc","lat1":0.4537856055185257,"lat0":0.4537856055185257,"long0":1.5707963267948966,"k0":0.99878641,"x0":2743195.5,"y0":914398.5,"a":"6377299.151","b":"6356098.145120132","datum_params":[295,736,257,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24381","projName":"lcc","lat1":0.33161255787892263,"lat0":0.33161255787892263,"long0":1.3962634015954636,"k0":0.99878641,"x0":2743195.5,"y0":914398.5,"a":"6377299.151","b":"6356098.145120132","datum_params":[295,736,257,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24382","projName":"lcc","lat1":0.4537856055185257,"lat0":0.4537856055185257,"long0":1.5707963267948966,"k0":0.99878641,"x0":2743195.592233322,"y0":914398.5307444407,"a":"6377299.36559538","b":"6356098.359005156","to_meter":0.9143985307444408,"no_defs":true},{"EPSG":"24383","projName":"lcc","lat1":0.20943951023931956,"lat0":0.20943951023931956,"long0":1.3962634015954636,"k0":0.99878641,"x0":2743195.5,"y0":914398.5,"a":"6377299.151","b":"6356098.145120132","datum_params":[295,736,257,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24500","projName":"cass","lat0":0.022473673935663258,"long0":1.8125768268587652,"x0":30000,"y0":30000,"a":"6377304.063","b":"6356103.038993155","datum_params":[-11,851,5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24547","projName":"utm","zone":47,"a":"6377304.063","b":"6356103.038993155","datum_params":[-11,851,5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24548","projName":"utm","zone":48,"a":"6377304.063","b":"6356103.038993155","datum_params":[-11,851,5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24571","projName":"omerc","lat0":0.06981317007977318,"longc":1.784599160164202,"alpha":5.637863613082421,"k0":0.99984,"x0":804671.2997750348,"y0":0,"no_uoff":true,"gamma":"323.1301023611111","a":"6377304.063","b":"6356103.038993155","datum_params":[-11,851,5,0,0,0,0],"to_meter":20.11678249437587,"no_defs":true},{"EPSG":"24600","projName":"lcc","lat1":0.5672320068981571,"lat0":0.5672320068981571,"long0":0.7853981633974483,"k0":0.9987864078,"x0":1500000,"y0":1166200,"ellps":"clrk80","datum_params":[-294.7,-200.1,525.5,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24718","projName":"utm","zone":18,"ellps":"intl","datum_params":[-273.5,110.6,-357.9,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24719","projName":"utm","zone":19,"ellps":"intl","datum_params":[-273.5,110.6,-357.9,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24720","projName":"utm","zone":20,"ellps":"intl","datum_params":[-273.5,110.6,-357.9,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24817","projName":"utm","zone":17,"ellps":"intl","datum_params":[-288,175,-376,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24818","projName":"utm","zone":18,"ellps":"intl","datum_params":[-288,175,-376,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24819","projName":"utm","zone":19,"ellps":"intl","datum_params":[-288,175,-376,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24820","projName":"utm","zone":20,"ellps":"intl","datum_params":[-288,175,-376,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24821","projName":"utm","zone":21,"ellps":"intl","datum_params":[-288,175,-376,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24877","projName":"utm","zone":17,"utmSouth":true,"ellps":"intl","datum_params":[-288,175,-376,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24878","projName":"utm","zone":18,"utmSouth":true,"ellps":"intl","datum_params":[-288,175,-376,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24879","projName":"utm","zone":19,"utmSouth":true,"ellps":"intl","datum_params":[-288,175,-376,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24880","projName":"utm","zone":20,"utmSouth":true,"ellps":"intl","datum_params":[-288,175,-376,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24881","projName":"utm","zone":21,"utmSouth":true,"ellps":"intl","datum_params":[-288,175,-376,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24882","projName":"utm","zone":22,"utmSouth":true,"ellps":"intl","datum_params":[-288,175,-376,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24891","projName":"tmerc","lat0":-0.10471975511965978,"long0":-1.4049900478554354,"k0":0.99983008,"x0":222000,"y0":1426834.743,"ellps":"intl","datum_params":[-288,175,-376,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24892","projName":"tmerc","lat0":-0.16580627893946132,"long0":-1.3264502315156905,"k0":0.99932994,"x0":720000,"y0":1039979.159,"ellps":"intl","datum_params":[-288,175,-376,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"24893","projName":"tmerc","lat0":-0.16580627893946132,"long0":-1.2304571226560024,"k0":0.99952992,"x0":1324000,"y0":1040084.558,"ellps":"intl","datum_params":[-288,175,-376,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"25000","projName":"tmerc","lat0":0.08144869842640205,"long0":-0.017453292519943295,"k0":0.99975,"x0":274319.51,"y0":0,"ellps":"clrk80","datum_params":[-130,29,364,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"25231","projName":"utm","zone":31,"a":"6378249.2","b":"6356515","units":"m","no_defs":true},{"EPSG":"25391","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":0.99995,"x0":500000,"y0":0,"ellps":"clrk66","datum_params":[-133,-77,-51,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"25392","projName":"tmerc","lat0":0,"long0":2.076941809873252,"k0":0.99995,"x0":500000,"y0":0,"ellps":"clrk66","datum_params":[-133,-77,-51,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"25393","projName":"tmerc","lat0":0,"long0":2.111848394913139,"k0":0.99995,"x0":500000,"y0":0,"ellps":"clrk66","datum_params":[-133,-77,-51,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"25394","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":0.99995,"x0":500000,"y0":0,"ellps":"clrk66","datum_params":[-133,-77,-51,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"25395","projName":"tmerc","lat0":0,"long0":2.181661564992912,"k0":0.99995,"x0":500000,"y0":0,"ellps":"clrk66","datum_params":[-133,-77,-51,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"25700","projName":"merc","long0":1.9198621771937625,"k0":0.997,"x0":3900000,"y0":900000,"ellps":"bessel","datum_params":[-587.8,519.75,145.76,0,0,0,0],"from_greenwich":1.8641463708519166,"units":"m","no_defs":true},{"EPSG":"25828","projName":"utm","zone":28,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"25829","projName":"utm","zone":29,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"25830","projName":"utm","zone":30,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"25831","projName":"utm","zone":31,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"25832","projName":"utm","zone":32,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"25833","projName":"utm","zone":33,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"25834","projName":"utm","zone":34,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"25835","projName":"utm","zone":35,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"25836","projName":"utm","zone":36,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"25837","projName":"utm","zone":37,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"25838","projName":"utm","zone":38,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"25884","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":0.9996,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"25932","projName":"utm","zone":32,"utmSouth":true,"ellps":"intl","datum_params":[-254.1,-5.36,-100.29,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26191","projName":"lcc","lat1":0.5811946409141117,"lat0":0.5811946409141117,"long0":-0.0942477796076938,"k0":0.999625769,"x0":500000,"y0":300000,"a":"6378249.2","b":"6356515","datum_params":[31,146,47,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26192","projName":"lcc","lat1":0.5183627878423158,"lat0":0.5183627878423158,"long0":-0.0942477796076938,"k0":0.999615596,"x0":500000,"y0":300000,"a":"6378249.2","b":"6356515","datum_params":[31,146,47,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26193","projName":"lcc","lat1":0.45553093477052004,"lat0":0.45553093477052004,"long0":-0.0942477796076938,"k0":0.9996,"x0":1200000,"y0":400000,"a":"6378249.2","b":"6356515","datum_params":[31,146,47,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26194","projName":"lcc","lat1":0.45553093477052004,"lat0":0.45553093477052004,"long0":-0.0942477796076938,"k0":0.999616304,"x0":1200000,"y0":400000,"a":"6378249.2","b":"6356515","datum_params":[31,146,47,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26195","projName":"lcc","lat1":0.39269908169872414,"lat0":0.39269908169872414,"long0":-0.0942477796076938,"k0":0.999616437,"x0":1500000,"y0":400000,"a":"6378249.2","b":"6356515","datum_params":[31,146,47,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26237","projName":"utm","zone":37,"ellps":"bessel","datum_params":[639,405,60,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26331","projName":"utm","zone":31,"ellps":"clrk80","datum_params":[-92,-93,122,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26332","projName":"utm","zone":32,"ellps":"clrk80","datum_params":[-92,-93,122,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26391","projName":"tmerc","lat0":0.06981317007977318,"long0":0.07853981633974483,"k0":0.99975,"x0":230738.26,"y0":0,"ellps":"clrk80","datum_params":[-92,-93,122,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26392","projName":"tmerc","lat0":0.06981317007977318,"long0":0.14835298641951802,"k0":0.99975,"x0":670553.98,"y0":0,"ellps":"clrk80","datum_params":[-92,-93,122,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26393","projName":"tmerc","lat0":0.06981317007977318,"long0":0.2181661564992912,"k0":0.99975,"x0":1110369.7,"y0":0,"ellps":"clrk80","datum_params":[-92,-93,122,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26432","projName":"utm","zone":32,"utmSouth":true,"ellps":"intl","datum_params":[-252.95,-4.11,-96.38,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26591","projName":"tmerc","lat0":0,"long0":-0.06025458354301751,"k0":0.9996,"x0":1500000,"y0":0,"ellps":"intl","datum_params":[-104.1,-49.1,-9.9,0.971,-2.917,0.714,-11.68],"from_greenwich":0.2173342162225014,"units":"m","no_defs":true},{"EPSG":"26592","projName":"tmerc","lat0":0,"long0":0.044465171576642086,"k0":0.9996,"x0":2520000,"y0":0,"ellps":"intl","datum_params":[-104.1,-49.1,-9.9,0.971,-2.917,0.714,-11.68],"from_greenwich":0.2173342162225014,"units":"m","no_defs":true},{"EPSG":"26632","projName":"utm","zone":32,"a":"6378249.2","b":"6356515","datum_params":[-74,-130,42,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26692","projName":"utm","zone":32,"utmSouth":true,"a":"6378249.2","b":"6356515","datum_params":[-74,-130,42,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26701","projName":"utm","zone":1,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26702","projName":"utm","zone":2,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26703","projName":"utm","zone":3,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26704","projName":"utm","zone":4,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26705","projName":"utm","zone":5,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26706","projName":"utm","zone":6,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26707","projName":"utm","zone":7,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26708","projName":"utm","zone":8,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26709","projName":"utm","zone":9,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26710","projName":"utm","zone":10,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26711","projName":"utm","zone":11,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26712","projName":"utm","zone":12,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26713","projName":"utm","zone":13,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26714","projName":"utm","zone":14,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26715","projName":"utm","zone":15,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26716","projName":"utm","zone":16,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26717","projName":"utm","zone":17,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26718","projName":"utm","zone":18,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26719","projName":"utm","zone":19,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26720","projName":"utm","zone":20,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26721","projName":"utm","zone":21,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26722","projName":"utm","zone":22,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"26729","projName":"tmerc","lat0":0.5323254218582705,"long0":-1.498074274628466,"k0":0.99996,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26730","projName":"tmerc","lat0":0.5235987755982988,"long0":-1.5271630954950384,"k0":0.999933333,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26731","projName":"omerc","lat0":0.9948376736367679,"longc":-2.332923433499088,"alpha":5.639684198507691,"k0":0.9999,"x0":5000000.001016002,"y0":-5000000.001016002,"no_uoff":true,"gamma":"323.1301023611111","datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26732","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.478367537831948,"k0":0.9999,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26733","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.548180707911721,"k0":0.9999,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26734","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.6179938779914944,"k0":0.9999,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26735","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.6878070480712677,"k0":0.9999,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26736","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.7576202181510405,"k0":0.9999,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26737","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.827433388230814,"k0":0.9999,"x0":213360.4267208534,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26738","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.897246558310587,"k0":0.9999,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26739","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.9670597283903604,"k0":0.9999,"x0":182880.3657607315,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26740","projName":"lcc","lat1":0.9395689139902809,"lat2":0.9046623289503943,"lat0":0.8901179185171081,"long0":-3.07177948351002,"x0":914401.8288036576,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26741","projName":"lcc","lat1":0.7272205216643038,"lat2":0.6981317007977318,"lat0":0.6864961724511032,"long0":-2.129301687433082,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26742","projName":"lcc","lat1":0.6952228187110747,"lat2":0.6690428799311599,"lat0":0.6574073515845307,"long0":-2.129301687433082,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26743","projName":"lcc","lat1":0.670788209183154,"lat2":0.6469353760725649,"lat0":0.6370451769779303,"long0":-2.1031217486531673,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26744","projName":"lcc","lat1":0.6501351463678877,"lat2":0.6283185307179586,"lat0":0.6166830023713299,"long0":-2.076941809873252,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26745","projName":"lcc","lat1":0.6190101080406556,"lat2":0.5939937220954035,"lat0":0.5846852994181004,"long0":-2.059488517353309,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26746","projName":"lcc","lat1":0.591375728217412,"lat2":0.5721771064454744,"lat0":0.5614142427248425,"long0":-2.028945255443408,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26747","projName":"lcc","lat1":0.6006841508947149,"lat2":0.5910848400087463,"lat0":0.5957390513473978,"long0":-2.0653062815266225,"x0":1276106.450596901,"y0":127079.524511049,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26748","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.9227710592804204,"k0":0.9999,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26749","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.953314321190321,"k0":0.9999,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26750","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.9853120241435498,"k0":0.999933333,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26751","projName":"lcc","lat1":0.6323909656392787,"lat2":0.6097016853633525,"lat0":0.5992297098513867,"long0":-1.6057029118347832,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26752","projName":"lcc","lat1":0.6067928032766954,"lat2":0.5811946409141117,"lat0":0.5701408889848142,"long0":-1.6057029118347832,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26753","projName":"lcc","lat1":0.6931866012504145,"lat2":0.7118034466050207,"lat0":0.6864961724511032,"long0":-1.8413223608540177,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26754","projName":"lcc","lat1":0.693768377667746,"lat2":0.6710790973918198,"lat0":0.6603162336711882,"long0":-1.8413223608540177,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26755","projName":"lcc","lat1":0.670788209183154,"lat2":0.649844258159222,"lat0":0.6399540590645874,"long0":-1.8413223608540177,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26756","projName":"lcc","lat1":0.7307111801682926,"lat2":0.7190756518216638,"lat0":0.712676111231018,"long0":-1.2697270308258748,"x0":182880.3657607315,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26757","projName":"tmerc","lat0":0.6632251157578453,"long0":-1.3162691442123904,"k0":0.999995,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26758","projName":"tmerc","lat0":0.42469678465195343,"long0":-1.413716694115407,"k0":0.999941177,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26759","projName":"tmerc","lat0":0.42469678465195343,"long0":-1.4311699866353502,"k0":0.999941177,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26760","projName":"lcc","lat1":0.5366887449882564,"lat2":0.5163265703816557,"lat0":0.5061454830783556,"long0":-1.4748032179352084,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26766","projName":"tmerc","lat0":0.5235987755982988,"long0":-1.4340788687220076,"k0":0.9999,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26767","projName":"tmerc","lat0":0.5235987755982988,"long0":-1.468985453761894,"k0":0.9999,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26768","projName":"tmerc","lat0":0.7272205216643038,"long0":-1.957677644320307,"k0":0.999947368,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26769","projName":"tmerc","lat0":0.7272205216643038,"long0":-1.9896753472735358,"k0":0.999947368,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26770","projName":"tmerc","lat0":0.7272205216643038,"long0":-2.0202186091834364,"k0":0.999933333,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26771","projName":"tmerc","lat0":0.6399540590645874,"long0":-1.5417075059283243,"k0":0.999975,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26772","projName":"tmerc","lat0":0.6399540590645874,"long0":-1.573705208881554,"k0":0.999941177,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26773","projName":"tmerc","lat0":0.6544984694978736,"long0":-1.4951653925418091,"k0":0.999966667,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26774","projName":"tmerc","lat0":0.6544984694978736,"long0":-1.5198908902783952,"k0":0.999966667,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26775","projName":"lcc","lat1":0.7551457896962134,"lat2":0.7342018386722814,"lat0":0.7243116395776468,"long0":-1.631882850614698,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26776","projName":"lcc","lat1":0.729256739124964,"lat2":0.7088945645183635,"lat0":0.6981317007977318,"long0":-1.631882850614698,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26777","projName":"lcc","lat1":0.6943501540850774,"lat2":0.6757333087304713,"lat0":0.6690428799311599,"long0":-1.710422666954443,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26778","projName":"lcc","lat1":0.6731153148524798,"lat2":0.6504260345765536,"lat0":0.6399540590645874,"long0":-1.7191493132144147,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26779","projName":"lcc","lat1":0.6626433393405138,"lat2":0.6800966318604571,"lat0":0.6544984694978736,"long0":-1.4704398948052226,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26780","projName":"lcc","lat1":0.6411176118992503,"lat2":0.6620615629231823,"lat0":0.6341362948912732,"long0":-1.4966198335851375,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26781","projName":"lcc","lat1":0.5439609502048994,"lat2":0.5701408889848142,"lat0":0.5352343039449278,"long0":-1.6144295580947547,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26782","projName":"lcc","lat1":0.5113814708343386,"lat2":0.5358160803622591,"lat0":0.5003277189050412,"long0":-1.5940673834881542,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26783","projName":"tmerc","lat0":0.765035988790848,"long0":-1.1955505376161157,"k0":0.9999,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26784","projName":"tmerc","lat0":0.7475826962709047,"long0":-1.224639358482688,"k0":0.999966667,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26785","projName":"lcc","lat1":0.6684611035138281,"lat2":0.688532389911763,"lat0":0.6603162336711882,"long0":-1.3439035240356338,"x0":243840.4876809754,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26786","projName":"lcc","lat1":0.7280931862903012,"lat2":0.7449647023929129,"lat0":0.7155849933176751,"long0":-1.2479104151759457,"x0":182880.3657607315,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26787","projName":"lcc","lat1":0.7205300928649924,"lat2":0.7240207513689809,"lat0":0.7155849933176751,"long0":-1.2304571226560024,"x0":60960.12192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26791","projName":"lcc","lat1":0.8208865248546663,"lat2":0.8488117928865756,"lat0":0.8115781021773633,"long0":-1.6249015336067207,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26792","projName":"lcc","lat1":0.79616102711808,"lat2":0.821177413063332,"lat0":0.7853981633974483,"long0":-1.6449728200046556,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26793","projName":"lcc","lat1":0.7641633241648506,"lat2":0.7891797101101027,"lat0":0.7504915783575618,"long0":-1.6406094968746698,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26794","projName":"tmerc","lat0":0.5177810114249846,"long0":-1.550434152188296,"k0":0.99996,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26795","projName":"tmerc","lat0":0.5323254218582705,"long0":-1.576614090968211,"k0":0.999941177,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26796","projName":"tmerc","lat0":0.6254096486313016,"long0":-1.5795229730548683,"k0":0.999933333,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26797","projName":"tmerc","lat0":0.6254096486313016,"long0":-1.6144295580947547,"k0":0.999933333,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26798","projName":"tmerc","lat0":0.6312274128046157,"long0":-1.6493361431346414,"k0":0.999941177,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26799","projName":"lcc","lat1":0.6006841508947149,"lat2":0.5910848400087463,"lat0":0.5957390513473978,"long0":-2.0653062815266225,"x0":1276106.450596901,"y0":1268253.006858014,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"26801","projName":"tmerc","lat0":0.7243116395776468,"long0":-1.4602588075019225,"k0":0.999942857,"x0":152400.3048006096,"y0":0,"a":"6378450.047548896","b":"6356826.621488444","units":"us-ft","no_defs":true},{"EPSG":"26802","projName":"tmerc","lat0":0.7243116395776468,"long0":-1.4966198335851375,"k0":0.999909091,"x0":152400.3048006096,"y0":0,"a":"6378450.047548896","b":"6356826.621488444","units":"us-ft","no_defs":true},{"EPSG":"26803","projName":"tmerc","lat0":0.7243116395776468,"long0":-1.5489797111449675,"k0":0.999909091,"x0":152400.3048006096,"y0":0,"a":"6378450.047548896","b":"6356826.621488444","units":"us-ft","no_defs":true},{"EPSG":"26811","projName":"lcc","lat1":0.7938339214487541,"lat2":0.8217591894806636,"lat0":0.7816166166847939,"long0":-1.5184364492350666,"x0":609601.2192024384,"y0":0,"a":"6378450.047548896","b":"6356826.621488444","units":"us-ft","no_defs":true},{"EPSG":"26812","projName":"lcc","lat1":0.7711446411728279,"lat2":0.7976154681614086,"lat0":0.7560184543222105,"long0":-1.4718943358485512,"x0":609601.2192024384,"y0":0,"a":"6378450.047548896","b":"6356826.621488444","units":"us-ft","no_defs":true},{"EPSG":"26813","projName":"lcc","lat1":0.7347836150896128,"lat2":0.7621271067041904,"lat0":0.7243116395776468,"long0":-1.4718943358485512,"x0":609601.2192024384,"y0":0,"a":"6378450.047548896","b":"6356826.621488444","units":"us-ft","no_defs":true},{"EPSG":"26814","projName":"tmerc","lat0":0.7621271067041904,"long0":-1.1955505376161157,"k0":0.9999,"x0":300000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26815","projName":"tmerc","lat0":0.7475826962709047,"long0":-1.224639358482688,"k0":0.999966667,"x0":900000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26819","projName":"lcc","lat1":0.8488117928865756,"lat2":0.8208865248546663,"lat0":0.8115781021773633,"long0":-1.6249015336067207,"x0":800000.0000101601,"y0":99999.99998984,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26820","projName":"lcc","lat1":0.821177413063332,"lat2":0.79616102711808,"lat0":0.7853981633974483,"long0":-1.6449728200046556,"x0":800000.0000101601,"y0":99999.99998984,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26821","projName":"lcc","lat1":0.7891797101101027,"lat2":0.7641633241648506,"lat0":0.7504915783575618,"long0":-1.6406094968746698,"x0":800000.0000101601,"y0":99999.99998984,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26822","projName":"lcc","lat1":0.7504915783575618,"lat2":0.6981317007977318,"lat0":0.6952228187110747,"long0":-1.7453292519943295,"x0":500000.0000101601,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26823","projName":"lcc","lat1":0.7024950239277177,"lat2":0.6806784082777885,"lat0":0.6719517620178169,"long0":-1.387536755335492,"x0":1968500,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26824","projName":"lcc","lat1":0.6786421908171285,"lat2":0.6542075812892078,"lat0":0.6457718232379019,"long0":-1.413716694115407,"x0":1968500,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26825","projName":"tmerc","lat0":0.7621271067041904,"long0":-1.1955505376161157,"k0":0.9999,"x0":300000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26826","projName":"tmerc","lat0":0.7475826962709047,"long0":-1.224639358482688,"k0":0.999966667,"x0":900000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26830","projName":"lcc","lat1":0.8488117928865756,"lat2":0.8208865248546663,"lat0":0.8115781021773633,"long0":-1.6249015336067207,"x0":800000.0000101601,"y0":99999.99998984,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26831","projName":"lcc","lat1":0.821177413063332,"lat2":0.79616102711808,"lat0":0.7853981633974483,"long0":-1.6449728200046556,"x0":800000.0000101601,"y0":99999.99998984,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26832","projName":"lcc","lat1":0.7891797101101027,"lat2":0.7641633241648506,"lat0":0.7504915783575618,"long0":-1.6406094968746698,"x0":800000.0000101601,"y0":99999.99998984,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26833","projName":"lcc","lat1":0.7504915783575618,"lat2":0.6981317007977318,"lat0":0.6952228187110747,"long0":-1.7453292519943295,"x0":500000.0000101601,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26834","projName":"lcc","lat1":0.7024950239277177,"lat2":0.6806784082777885,"lat0":0.6719517620178169,"long0":-1.387536755335492,"x0":1968500,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26835","projName":"lcc","lat1":0.6786421908171285,"lat2":0.6542075812892078,"lat0":0.6457718232379019,"long0":-1.413716694115407,"x0":1968500,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26836","projName":"tmerc","lat0":0.7621271067041904,"long0":-1.1955505376161157,"k0":0.9999,"x0":300000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26837","projName":"tmerc","lat0":0.7475826962709047,"long0":-1.224639358482688,"k0":0.999966667,"x0":900000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26841","projName":"lcc","lat1":0.8488117928865756,"lat2":0.8208865248546663,"lat0":0.8115781021773633,"long0":-1.6249015336067207,"x0":800000.0000101601,"y0":99999.99998984,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26842","projName":"lcc","lat1":0.821177413063332,"lat2":0.79616102711808,"lat0":0.7853981633974483,"long0":-1.6449728200046556,"x0":800000.0000101601,"y0":99999.99998984,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26843","projName":"lcc","lat1":0.7891797101101027,"lat2":0.7641633241648506,"lat0":0.7504915783575618,"long0":-1.6406094968746698,"x0":800000.0000101601,"y0":99999.99998984,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26844","projName":"lcc","lat1":0.7504915783575618,"lat2":0.6981317007977318,"lat0":0.6952228187110747,"long0":-1.7453292519943295,"x0":500000.0000101601,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26845","projName":"lcc","lat1":0.7024950239277177,"lat2":0.6806784082777885,"lat0":0.6719517620178169,"long0":-1.387536755335492,"x0":1968500,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26846","projName":"lcc","lat1":0.6786421908171285,"lat2":0.6542075812892078,"lat0":0.6457718232379019,"long0":-1.413716694115407,"x0":1968500,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26847","projName":"tmerc","lat0":0.7621271067041904,"long0":-1.1955505376161157,"k0":0.9999,"x0":300000.0000000001,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"26848","projName":"tmerc","lat0":0.7475826962709047,"long0":-1.224639358482688,"k0":0.999966667,"x0":900000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"26849","projName":"lcc","lat1":0.8488117928865756,"lat2":0.8208865248546663,"lat0":0.8115781021773633,"long0":-1.6249015336067207,"x0":800000.0000101599,"y0":99999.99998983997,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"26850","projName":"lcc","lat1":0.821177413063332,"lat2":0.79616102711808,"lat0":0.7853981633974483,"long0":-1.6449728200046556,"x0":800000.0000101599,"y0":99999.99998983997,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"26851","projName":"lcc","lat1":0.7891797101101027,"lat2":0.7641633241648506,"lat0":0.7504915783575618,"long0":-1.6406094968746698,"x0":800000.0000101599,"y0":99999.99998983997,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"26852","projName":"lcc","lat1":0.7504915783575618,"lat2":0.6981317007977318,"lat0":0.6952228187110747,"long0":-1.7453292519943295,"x0":500000.00001016,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"26853","projName":"lcc","lat1":0.7024950239277177,"lat2":0.6806784082777885,"lat0":0.6719517620178169,"long0":-1.387536755335492,"x0":600000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"26854","projName":"lcc","lat1":0.6786421908171285,"lat2":0.6542075812892078,"lat0":0.6457718232379019,"long0":-1.413716694115407,"x0":600000,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"26855","projName":"tmerc","lat0":0.7621271067041904,"long0":-1.1955505376161157,"k0":0.9999,"x0":300000.0000000001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"26856","projName":"tmerc","lat0":0.7475826962709047,"long0":-1.224639358482688,"k0":0.999966667,"x0":900000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"26857","projName":"lcc","lat1":0.8488117928865756,"lat2":0.8208865248546663,"lat0":0.8115781021773633,"long0":-1.6249015336067207,"x0":800000.0000101599,"y0":99999.99998983997,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"26858","projName":"lcc","lat1":0.821177413063332,"lat2":0.79616102711808,"lat0":0.7853981633974483,"long0":-1.6449728200046556,"x0":800000.0000101599,"y0":99999.99998983997,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"26859","projName":"lcc","lat1":0.7891797101101027,"lat2":0.7641633241648506,"lat0":0.7504915783575618,"long0":-1.6406094968746698,"x0":800000.0000101599,"y0":99999.99998983997,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"26860","projName":"lcc","lat1":0.7504915783575618,"lat2":0.6981317007977318,"lat0":0.6952228187110747,"long0":-1.7453292519943295,"x0":500000.00001016,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"26861","projName":"lcc","lat1":0.7024950239277177,"lat2":0.6806784082777885,"lat0":0.6719517620178169,"long0":-1.387536755335492,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"26862","projName":"lcc","lat1":0.6786421908171285,"lat2":0.6542075812892078,"lat0":0.6457718232379019,"long0":-1.413716694115407,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"26863","projName":"tmerc","lat0":0.7621271067041904,"long0":-1.1955505376161157,"k0":0.9999,"x0":300000.0000000001,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"26864","projName":"tmerc","lat0":0.7475826962709047,"long0":-1.224639358482688,"k0":0.999966667,"x0":900000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"26865","projName":"lcc","lat1":0.8488117928865756,"lat2":0.8208865248546663,"lat0":0.8115781021773633,"long0":-1.6249015336067207,"x0":800000.0000101599,"y0":99999.99998983997,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"26866","projName":"lcc","lat1":0.821177413063332,"lat2":0.79616102711808,"lat0":0.7853981633974483,"long0":-1.6449728200046556,"x0":800000.0000101599,"y0":99999.99998983997,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"26867","projName":"lcc","lat1":0.7891797101101027,"lat2":0.7641633241648506,"lat0":0.7504915783575618,"long0":-1.6406094968746698,"x0":800000.0000101599,"y0":99999.99998983997,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"26868","projName":"lcc","lat1":0.7504915783575618,"lat2":0.6981317007977318,"lat0":0.6952228187110747,"long0":-1.7453292519943295,"x0":500000.00001016,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"26869","projName":"lcc","lat1":0.7024950239277177,"lat2":0.6806784082777885,"lat0":0.6719517620178169,"long0":-1.387536755335492,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"26870","projName":"lcc","lat1":0.6786421908171285,"lat2":0.6542075812892078,"lat0":0.6457718232379019,"long0":-1.413716694115407,"x0":600000,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"us-ft","no_defs":true},{"EPSG":"26891","projName":"tmerc","lat0":0,"long0":-1.4398966328953218,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26892","projName":"tmerc","lat0":0,"long0":-1.413716694115407,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26893","projName":"tmerc","lat0":0,"long0":-1.4660765716752369,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26894","projName":"tmerc","lat0":0,"long0":-1.5184364492350666,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26895","projName":"tmerc","lat0":0,"long0":-1.5707963267948966,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26896","projName":"tmerc","lat0":0,"long0":-1.6231562043547265,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26897","projName":"tmerc","lat0":0,"long0":-1.6755160819145565,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26898","projName":"tmerc","lat0":0,"long0":-0.9250245035569946,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26899","projName":"tmerc","lat0":0,"long0":-0.9773843811168246,"k0":0.9999,"x0":304800,"y0":0,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"26901","projName":"utm","zone":1,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26902","projName":"utm","zone":2,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26903","projName":"utm","zone":3,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26904","projName":"utm","zone":4,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26905","projName":"utm","zone":5,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26906","projName":"utm","zone":6,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26907","projName":"utm","zone":7,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26908","projName":"utm","zone":8,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26909","projName":"utm","zone":9,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26910","projName":"utm","zone":10,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26911","projName":"utm","zone":11,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26912","projName":"utm","zone":12,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26913","projName":"utm","zone":13,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26914","projName":"utm","zone":14,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26915","projName":"utm","zone":15,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26916","projName":"utm","zone":16,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26917","projName":"utm","zone":17,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26918","projName":"utm","zone":18,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26919","projName":"utm","zone":19,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26920","projName":"utm","zone":20,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26921","projName":"utm","zone":21,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26922","projName":"utm","zone":22,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26923","projName":"utm","zone":23,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26929","projName":"tmerc","lat0":0.5323254218582705,"long0":-1.498074274628466,"k0":0.99996,"x0":200000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26930","projName":"tmerc","lat0":0.5235987755982988,"long0":-1.5271630954950384,"k0":0.999933333,"x0":600000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26931","projName":"omerc","lat0":0.9948376736367679,"longc":-2.332923433499088,"alpha":5.639684198507691,"k0":0.9999,"x0":5000000,"y0":-5000000,"no_uoff":true,"gamma":"323.1301023611111","datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26932","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.478367537831948,"k0":0.9999,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26933","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.548180707911721,"k0":0.9999,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26934","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.6179938779914944,"k0":0.9999,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26935","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.6878070480712677,"k0":0.9999,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26936","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.7576202181510405,"k0":0.9999,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26937","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.827433388230814,"k0":0.9999,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26938","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.897246558310587,"k0":0.9999,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26939","projName":"tmerc","lat0":0.9424777960769379,"long0":-2.9670597283903604,"k0":0.9999,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26940","projName":"lcc","lat1":0.9395689139902809,"lat2":0.9046623289503943,"lat0":0.8901179185171081,"long0":-3.07177948351002,"x0":1000000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26941","projName":"lcc","lat1":0.7272205216643038,"lat2":0.6981317007977318,"lat0":0.6864961724511032,"long0":-2.129301687433082,"x0":2000000,"y0":500000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26942","projName":"lcc","lat1":0.6952228187110747,"lat2":0.6690428799311599,"lat0":0.6574073515845307,"long0":-2.129301687433082,"x0":2000000,"y0":500000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26943","projName":"lcc","lat1":0.670788209183154,"lat2":0.6469353760725649,"lat0":0.6370451769779303,"long0":-2.1031217486531673,"x0":2000000,"y0":500000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26944","projName":"lcc","lat1":0.6501351463678877,"lat2":0.6283185307179586,"lat0":0.6166830023713299,"long0":-2.076941809873252,"x0":2000000,"y0":500000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26945","projName":"lcc","lat1":0.6190101080406556,"lat2":0.5939937220954035,"lat0":0.5846852994181004,"long0":-2.059488517353309,"x0":2000000,"y0":500000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26946","projName":"lcc","lat1":0.591375728217412,"lat2":0.5721771064454744,"lat0":0.5614142427248425,"long0":-2.028945255443408,"x0":2000000,"y0":500000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26948","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.9227710592804204,"k0":0.9999,"x0":213360,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26949","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.953314321190321,"k0":0.9999,"x0":213360,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26950","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.9853120241435498,"k0":0.999933333,"x0":213360,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26951","projName":"lcc","lat1":0.6323909656392787,"lat2":0.6097016853633525,"lat0":0.5992297098513867,"long0":-1.6057029118347832,"x0":400000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26952","projName":"lcc","lat1":0.6067928032766954,"lat2":0.5811946409141117,"lat0":0.5701408889848142,"long0":-1.6057029118347832,"x0":400000,"y0":400000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26953","projName":"lcc","lat1":0.7118034466050207,"lat2":0.6931866012504145,"lat0":0.6864961724511032,"long0":-1.8413223608540177,"x0":914401.8289,"y0":304800.6096,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26954","projName":"lcc","lat1":0.693768377667746,"lat2":0.6710790973918198,"lat0":0.6603162336711882,"long0":-1.8413223608540177,"x0":914401.8289,"y0":304800.6096,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26955","projName":"lcc","lat1":0.670788209183154,"lat2":0.649844258159222,"lat0":0.6399540590645874,"long0":-1.8413223608540177,"x0":914401.8289,"y0":304800.6096,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26956","projName":"lcc","lat1":0.7307111801682926,"lat2":0.7190756518216638,"lat0":0.712676111231018,"long0":-1.2697270308258748,"x0":304800.6096,"y0":152400.3048,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26957","projName":"tmerc","lat0":0.6632251157578453,"long0":-1.3162691442123904,"k0":0.999995,"x0":200000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26958","projName":"tmerc","lat0":0.42469678465195343,"long0":-1.413716694115407,"k0":0.999941177,"x0":200000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26959","projName":"tmerc","lat0":0.42469678465195343,"long0":-1.4311699866353502,"k0":0.999941177,"x0":200000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26960","projName":"lcc","lat1":0.5366887449882564,"lat2":0.5163265703816557,"lat0":0.5061454830783556,"long0":-1.4748032179352084,"x0":600000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26961","projName":"tmerc","lat0":0.32870367579226534,"long0":-2.7139869868511823,"k0":0.999966667,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26962","projName":"tmerc","lat0":0.35488361457218026,"long0":-2.734349161457784,"k0":0.999966667,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26963","projName":"tmerc","lat0":0.3694280250054665,"long0":-2.7576202181510405,"k0":0.99999,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26964","projName":"tmerc","lat0":0.3810635533520952,"long0":-2.7838001569309556,"k0":0.99999,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26965","projName":"tmerc","lat0":0.37815467126543817,"long0":-2.7954356852775852,"k0":1,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26966","projName":"tmerc","lat0":0.5235987755982988,"long0":-1.4340788687220076,"k0":0.9999,"x0":200000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26967","projName":"tmerc","lat0":0.5235987755982988,"long0":-1.468985453761894,"k0":0.9999,"x0":700000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26968","projName":"tmerc","lat0":0.7272205216643038,"long0":-1.957677644320307,"k0":0.999947368,"x0":200000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26969","projName":"tmerc","lat0":0.7272205216643038,"long0":-1.9896753472735358,"k0":0.999947368,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26970","projName":"tmerc","lat0":0.7272205216643038,"long0":-2.0202186091834364,"k0":0.999933333,"x0":800000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26971","projName":"tmerc","lat0":0.6399540590645874,"long0":-1.5417075059283243,"k0":0.999975,"x0":300000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26972","projName":"tmerc","lat0":0.6399540590645874,"long0":-1.573705208881554,"k0":0.999941177,"x0":700000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26973","projName":"tmerc","lat0":0.6544984694978736,"long0":-1.4951653925418091,"k0":0.999966667,"x0":100000,"y0":250000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26974","projName":"tmerc","lat0":0.6544984694978736,"long0":-1.5198908902783952,"k0":0.999966667,"x0":900000,"y0":250000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26975","projName":"lcc","lat1":0.7551457896962134,"lat2":0.7342018386722814,"lat0":0.7243116395776468,"long0":-1.631882850614698,"x0":1500000,"y0":1000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26976","projName":"lcc","lat1":0.729256739124964,"lat2":0.7088945645183635,"lat0":0.6981317007977318,"long0":-1.631882850614698,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26977","projName":"lcc","lat1":0.6943501540850774,"lat2":0.6757333087304713,"lat0":0.6690428799311599,"long0":-1.710422666954443,"x0":400000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26978","projName":"lcc","lat1":0.6731153148524798,"lat2":0.6504260345765536,"lat0":0.6399540590645874,"long0":-1.7191493132144147,"x0":400000,"y0":400000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26979","projName":"lcc","lat1":0.6626433393405138,"lat2":0.6626433393405138,"lat0":0.6544984694978736,"long0":-1.4704398948052226,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26980","projName":"lcc","lat1":0.6620615629231823,"lat2":0.6411176118992503,"lat0":0.6341362948912732,"long0":-1.4966198335851375,"x0":500000,"y0":500000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26981","projName":"lcc","lat1":0.5701408889848142,"lat2":0.5439609502048994,"lat0":0.5323254218582705,"long0":-1.6144295580947547,"x0":1000000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26982","projName":"lcc","lat1":0.5358160803622591,"lat2":0.5113814708343386,"lat0":0.49741883681838395,"long0":-1.5940673834881542,"x0":1000000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26983","projName":"tmerc","lat0":0.7621271067041904,"long0":-1.1955505376161157,"k0":0.9999,"x0":300000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26984","projName":"tmerc","lat0":0.7475826962709047,"long0":-1.224639358482688,"k0":0.999966667,"x0":900000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26985","projName":"lcc","lat1":0.688532389911763,"lat2":0.6684611035138281,"lat0":0.6574073515845307,"long0":-1.3439035240356338,"x0":400000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26986","projName":"lcc","lat1":0.7449647023929129,"lat2":0.7280931862903012,"lat0":0.7155849933176751,"long0":-1.2479104151759457,"x0":200000,"y0":750000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26987","projName":"lcc","lat1":0.7240207513689809,"lat2":0.7205300928649924,"lat0":0.7155849933176751,"long0":-1.2304571226560024,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26988","projName":"lcc","lat1":0.8217591894806636,"lat2":0.7938339214487541,"lat0":0.7816166166847939,"long0":-1.5184364492350666,"x0":8000000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26989","projName":"lcc","lat1":0.7976154681614086,"lat2":0.7711446411728279,"lat0":0.7560184543222105,"long0":-1.4724761122658825,"x0":6000000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26990","projName":"lcc","lat1":0.7621271067041904,"lat2":0.7347836150896128,"lat0":0.7243116395776468,"long0":-1.4724761122658825,"x0":4000000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26991","projName":"lcc","lat1":0.8488117928865756,"lat2":0.8208865248546663,"lat0":0.8115781021773633,"long0":-1.6249015336067207,"x0":800000,"y0":100000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26992","projName":"lcc","lat1":0.821177413063332,"lat2":0.79616102711808,"lat0":0.7853981633974483,"long0":-1.6449728200046556,"x0":800000,"y0":100000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26993","projName":"lcc","lat1":0.7891797101101027,"lat2":0.7641633241648506,"lat0":0.7504915783575618,"long0":-1.6406094968746698,"x0":800000,"y0":100000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26994","projName":"tmerc","lat0":0.5148721293383273,"long0":-1.550434152188296,"k0":0.99995,"x0":300000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26995","projName":"tmerc","lat0":0.5148721293383273,"long0":-1.576614090968211,"k0":0.99995,"x0":700000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26996","projName":"tmerc","lat0":0.6254096486313016,"long0":-1.5795229730548683,"k0":0.999933333,"x0":250000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26997","projName":"tmerc","lat0":0.6254096486313016,"long0":-1.6144295580947547,"k0":0.999933333,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"26998","projName":"tmerc","lat0":0.6312274128046157,"long0":-1.6493361431346414,"k0":0.999941177,"x0":850000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"27037","projName":"utm","zone":37,"ellps":"clrk80","datum_params":[-242.2,-144.9,370.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"27038","projName":"utm","zone":38,"ellps":"clrk80","datum_params":[-242.2,-144.9,370.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"27039","projName":"utm","zone":39,"ellps":"clrk80","datum_params":[-242.2,-144.9,370.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"27040","projName":"utm","zone":40,"ellps":"clrk80","datum_params":[-242.2,-144.9,370.3,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"27120","projName":"utm","zone":20,"ellps":"intl","datum_params":[-10,375,165,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"27200","projName":"nzmg","lat0":-0.7155849933176751,"long0":3.01941960595019,"x0":2510000,"y0":6023150,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27205","projName":"tmerc","lat0":-0.6436750767891555,"long0":3.050213136924112,"k0":0.9999,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27206","projName":"tmerc","lat0":-0.6590581387750131,"long0":3.079916160486263,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27207","projName":"tmerc","lat0":-0.6741282360764219,"long0":3.1046900450522927,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27208","projName":"tmerc","lat0":-0.6920392678574532,"long0":3.083537426826316,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27209","projName":"tmerc","lat0":-0.6830478376966616,"long0":3.0408524542408677,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27210","projName":"tmerc","lat0":-0.6896227038828755,"long0":3.0654969405809687,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27211","projName":"tmerc","lat0":-0.702354474987123,"long0":3.0628451362816693,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27212","projName":"tmerc","lat0":-0.7142852926810146,"long0":3.0656245740850987,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27213","projName":"tmerc","lat0":-0.7208440131172064,"long0":3.050427528806104,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27214","projName":"tmerc","lat0":-0.7106065996756215,"long0":3.0136957375817506,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27215","projName":"tmerc","lat0":-0.720376702664426,"long0":3.024643669713685,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27216","projName":"tmerc","lat0":-0.7206449040168844,"long0":3.003869214400806,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27217","projName":"tmerc","lat0":-0.7297361728286542,"long0":2.994657922690074,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27218","projName":"tmerc","lat0":-0.7388623496799053,"long0":2.9941083403252367,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27219","projName":"tmerc","lat0":-0.745065639146879,"long0":3.0195964669506865,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27220","projName":"tmerc","lat0":-0.7250880783842172,"long0":3.033418440034086,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27221","projName":"tmerc","lat0":-0.7485075292730574,"long0":2.9841638416135035,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27222","projName":"tmerc","lat0":-0.7524136769802664,"long0":2.9716137432855363,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27223","projName":"tmerc","lat0":-0.7675574582041851,"long0":2.9427344986466624,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27224","projName":"tmerc","lat0":-0.7608001488727507,"long0":3.0146582357587888,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27225","projName":"tmerc","lat0":-0.7635590601497346,"long0":2.9908092695221202,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27226","projName":"tmerc","lat0":-0.7749649404974545,"long0":2.9855122364514806,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27227","projName":"tmerc","lat0":-0.7807777178772449,"long0":2.9577703021675235,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27228","projName":"tmerc","lat0":-0.7877177510610212,"long0":2.9391107447276115,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27229","projName":"tmerc","lat0":-0.7952370410854278,"long0":2.9275954215698916,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27230","projName":"tmerc","lat0":-0.7996434816049569,"long0":2.978030783710817,"k0":1,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27231","projName":"tmerc","lat0":-0.80043440809876,"long0":2.971991838809533,"k0":0.99996,"x0":300000,"y0":700000,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27232","projName":"tmerc","lat0":-0.8133235991748913,"long0":2.9381373886633715,"k0":1,"x0":300002.66,"y0":699999.58,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27258","projName":"utm","zone":58,"utmSouth":true,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27259","projName":"utm","zone":59,"utmSouth":true,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27260","projName":"utm","zone":60,"utmSouth":true,"datumCode":"nzgd49","units":"m","no_defs":true},{"EPSG":"27291","projName":"tmerc","lat0":-0.6806784082777885,"long0":3.0630528372500483,"k0":1,"x0":274319.5243848086,"y0":365759.3658464114,"datumCode":"nzgd49","to_meter":0.9143984146160287,"no_defs":true},{"EPSG":"27292","projName":"tmerc","lat0":-0.767944870877505,"long0":2.993239667170275,"k0":1,"x0":457199.2073080143,"y0":457199.2073080143,"datumCode":"nzgd49","to_meter":0.9143984146160287,"no_defs":true},{"EPSG":"27391","projName":"tmerc","lat0":1.0122909661567112,"long0":-0.08144869842640205,"k0":1,"x0":0,"y0":0,"a":"6377492.018","b":"6356173.508712696","datum_params":[278.3,93,474.5,7.889,0.05,-6.61,6.21],"from_greenwich":0.18715020125031445,"units":"m","no_defs":true},{"EPSG":"27392","projName":"tmerc","lat0":1.0122909661567112,"long0":-0.04072434921320102,"k0":1,"x0":0,"y0":0,"a":"6377492.018","b":"6356173.508712696","datum_params":[278.3,93,474.5,7.889,0.05,-6.61,6.21],"from_greenwich":0.18715020125031445,"units":"m","no_defs":true},{"EPSG":"27393","projName":"tmerc","lat0":1.0122909661567112,"long0":0,"k0":1,"x0":0,"y0":0,"a":"6377492.018","b":"6356173.508712696","datum_params":[278.3,93,474.5,7.889,0.05,-6.61,6.21],"from_greenwich":0.18715020125031445,"units":"m","no_defs":true},{"EPSG":"27394","projName":"tmerc","lat0":1.0122909661567112,"long0":0.04363323129985824,"k0":1,"x0":0,"y0":0,"a":"6377492.018","b":"6356173.508712696","datum_params":[278.3,93,474.5,7.889,0.05,-6.61,6.21],"from_greenwich":0.18715020125031445,"units":"m","no_defs":true},{"EPSG":"27395","projName":"tmerc","lat0":1.0122909661567112,"long0":0.10762863720631699,"k0":1,"x0":0,"y0":0,"a":"6377492.018","b":"6356173.508712696","datum_params":[278.3,93,474.5,7.889,0.05,-6.61,6.21],"from_greenwich":0.18715020125031445,"units":"m","no_defs":true},{"EPSG":"27396","projName":"tmerc","lat0":1.0122909661567112,"long0":0.17744180728609021,"k0":1,"x0":0,"y0":0,"a":"6377492.018","b":"6356173.508712696","datum_params":[278.3,93,474.5,7.889,0.05,-6.61,6.21],"from_greenwich":0.18715020125031445,"units":"m","no_defs":true},{"EPSG":"27397","projName":"tmerc","lat0":1.0122909661567112,"long0":0.2472549773658634,"k0":1,"x0":0,"y0":0,"a":"6377492.018","b":"6356173.508712696","datum_params":[278.3,93,474.5,7.889,0.05,-6.61,6.21],"from_greenwich":0.18715020125031445,"units":"m","no_defs":true},{"EPSG":"27398","projName":"tmerc","lat0":1.0122909661567112,"long0":0.3199770295322937,"k0":1,"x0":0,"y0":0,"a":"6377492.018","b":"6356173.508712696","datum_params":[278.3,93,474.5,7.889,0.05,-6.61,6.21],"from_greenwich":0.18715020125031445,"units":"m","no_defs":true},{"EPSG":"27429","projName":"utm","zone":29,"ellps":"intl","datum_params":[-223.237,110.193,36.649,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"27492","projName":"tmerc","lat0":0.6923139366244172,"long0":-0.14192853610193676,"k0":1,"x0":180.598,"y0":-86.99,"ellps":"intl","datum_params":[-223.237,110.193,36.649,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"27493","projName":"tmerc","lat0":0.6923139366244172,"long0":-0.14192853610193676,"k0":1,"x0":180.598,"y0":-86.99,"ellps":"intl","datum_params":[-223.237,110.193,36.649,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"27500","projName":"lcc","lat1":0.8639379797371932,"lat0":0.8639379797371932,"long0":0.09424777960769377,"k0":0.99950908,"x0":500000,"y0":300000,"a":"6376523","b":"6355862.933255573","from_greenwich":0.0407919807217158,"units":"m","no_defs":true},{"EPSG":"27561","projName":"lcc","lat1":0.8639379797371932,"lat0":0.8639379797371932,"long0":0,"k0":0.999877341,"x0":600000,"y0":200000,"a":"6378249.2","b":"6356515","datum_params":[-168,-60,320,0,0,0,0],"from_greenwich":0.04079234433198245,"units":"m","no_defs":true},{"EPSG":"27562","projName":"lcc","lat1":0.8168140899333461,"lat0":0.8168140899333461,"long0":0,"k0":0.99987742,"x0":600000,"y0":200000,"a":"6378249.2","b":"6356515","datum_params":[-168,-60,320,0,0,0,0],"from_greenwich":0.04079234433198245,"units":"m","no_defs":true},{"EPSG":"27563","projName":"lcc","lat1":0.7696902001294995,"lat0":0.7696902001294995,"long0":0,"k0":0.999877499,"x0":600000,"y0":200000,"a":"6378249.2","b":"6356515","datum_params":[-168,-60,320,0,0,0,0],"from_greenwich":0.04079234433198245,"units":"m","no_defs":true},{"EPSG":"27564","projName":"lcc","lat1":0.7359180791034093,"lat0":0.7359180791034093,"long0":0,"k0":0.99994471,"x0":234.358,"y0":185861.369,"a":"6378249.2","b":"6356515","datum_params":[-168,-60,320,0,0,0,0],"from_greenwich":0.04079234433198245,"units":"m","no_defs":true},{"EPSG":"27571","projName":"lcc","lat1":0.8639379797371932,"lat0":0.8639379797371932,"long0":0,"k0":0.999877341,"x0":600000,"y0":1200000,"a":"6378249.2","b":"6356515","datum_params":[-168,-60,320,0,0,0,0],"from_greenwich":0.04079234433198245,"units":"m","no_defs":true},{"EPSG":"27572","projName":"lcc","lat1":0.8168140899333461,"lat0":0.8168140899333461,"long0":0,"k0":0.99987742,"x0":600000,"y0":2200000,"a":"6378249.2","b":"6356515","datum_params":[-168,-60,320,0,0,0,0],"from_greenwich":0.04079234433198245,"units":"m","no_defs":true},{"EPSG":"27573","projName":"lcc","lat1":0.7696902001294995,"lat0":0.7696902001294995,"long0":0,"k0":0.999877499,"x0":600000,"y0":3200000,"a":"6378249.2","b":"6356515","datum_params":[-168,-60,320,0,0,0,0],"from_greenwich":0.04079234433198245,"units":"m","no_defs":true},{"EPSG":"27574","projName":"lcc","lat1":0.7359180791034093,"lat0":0.7359180791034093,"long0":0,"k0":0.99994471,"x0":234.358,"y0":4185861.369,"a":"6378249.2","b":"6356515","datum_params":[-168,-60,320,0,0,0,0],"from_greenwich":0.04079234433198245,"units":"m","no_defs":true},{"EPSG":"27581","projName":"lcc","lat1":0.8639379797371932,"lat0":0.8639379797371932,"long0":0,"k0":0.999877341,"x0":600000,"y0":1200000,"a":"6378249.2","b":"6356515","datum_params":[-168,-60,320,0,0,0,0],"from_greenwich":0.04079234433198245,"units":"m","no_defs":true},{"EPSG":"27582","projName":"lcc","lat1":0.8168140899333461,"lat0":0.8168140899333461,"long0":0,"k0":0.99987742,"x0":600000,"y0":2200000,"a":"6378249.2","b":"6356515","datum_params":[-168,-60,320,0,0,0,0],"from_greenwich":0.04079234433198245,"units":"m","no_defs":true},{"EPSG":"27583","projName":"lcc","lat1":0.7696902001294995,"lat0":0.7696902001294995,"long0":0,"k0":0.999877499,"x0":600000,"y0":3200000,"a":"6378249.2","b":"6356515","datum_params":[-168,-60,320,0,0,0,0],"from_greenwich":0.04079234433198245,"units":"m","no_defs":true},{"EPSG":"27584","projName":"lcc","lat1":0.7359180791034093,"lat0":0.7359180791034093,"long0":0,"k0":0.99994471,"x0":234.358,"y0":4185861.369,"a":"6378249.2","b":"6356515","datum_params":[-168,-60,320,0,0,0,0],"from_greenwich":0.04079234433198245,"units":"m","no_defs":true},{"EPSG":"27591","projName":"lcc","lat1":0.8639379797371932,"lat0":0.8639379797371932,"long0":0,"k0":0.999877341,"x0":600000,"y0":200000,"a":"6378249.2","b":"6356515","datum_params":[-168,-60,320,0,0,0,0],"from_greenwich":0.04079234433198245,"units":"m","no_defs":true},{"EPSG":"27592","projName":"lcc","lat1":0.8168140899333461,"lat0":0.8168140899333461,"long0":0,"k0":0.99987742,"x0":600000,"y0":200000,"a":"6378249.2","b":"6356515","datum_params":[-168,-60,320,0,0,0,0],"from_greenwich":0.04079234433198245,"units":"m","no_defs":true},{"EPSG":"27593","projName":"lcc","lat1":0.7696902001294995,"lat0":0.7696902001294995,"long0":0,"k0":0.999877499,"x0":600000,"y0":200000,"a":"6378249.2","b":"6356515","datum_params":[-168,-60,320,0,0,0,0],"from_greenwich":0.04079234433198245,"units":"m","no_defs":true},{"EPSG":"27594","projName":"lcc","lat1":0.7359180791034093,"lat0":0.7359180791034093,"long0":0,"k0":0.99994471,"x0":234.358,"y0":185861.369,"a":"6378249.2","b":"6356515","datum_params":[-168,-60,320,0,0,0,0],"from_greenwich":0.04079234433198245,"units":"m","no_defs":true},{"EPSG":"27700","projName":"tmerc","lat0":0.8552113334772214,"long0":-0.03490658503988659,"k0":0.9996012717,"x0":400000,"y0":-100000,"datumCode":"OSGB36","units":"m","no_defs":true},{"EPSG":"28191","projName":"cass","lat0":0.5538644768276277,"long0":0.6145667421719186,"x0":170251.555,"y0":126867.909,"a":"6378300.789","b":"6356566.435","datum_params":[-275.722,94.7824,340.894,-8.001,-4.42,-11.821,1],"units":"m","no_defs":true},{"EPSG":"28192","projName":"tmerc","lat0":0.5538644768276277,"long0":0.6145667421719186,"k0":1,"x0":170251.555,"y0":1126867.909,"a":"6378300.789","b":"6356566.435","datum_params":[-275.722,94.7824,340.894,-8.001,-4.42,-11.821,1],"units":"m","no_defs":true},{"EPSG":"28193","projName":"cass","lat0":0.5538644768276277,"long0":0.6145667421719186,"x0":170251.555,"y0":1126867.909,"a":"6378300.789","b":"6356566.435","datum_params":[-275.722,94.7824,340.894,-8.001,-4.42,-11.821,1],"units":"m","no_defs":true},{"EPSG":"28232","projName":"utm","zone":32,"utmSouth":true,"a":"6378249.2","b":"6356515","datum_params":[-148,51,-291,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"28348","projName":"utm","zone":48,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"28349","projName":"utm","zone":49,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"28350","projName":"utm","zone":50,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"28351","projName":"utm","zone":51,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"28352","projName":"utm","zone":52,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"28353","projName":"utm","zone":53,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"28354","projName":"utm","zone":54,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"28355","projName":"utm","zone":55,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"28356","projName":"utm","zone":56,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"28357","projName":"utm","zone":57,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"28358","projName":"utm","zone":58,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"28402","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":1,"x0":2500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28403","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":3500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28404","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":4500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28405","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":5500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28406","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":6500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28407","projName":"tmerc","lat0":0,"long0":0.6806784082777885,"k0":1,"x0":7500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28408","projName":"tmerc","lat0":0,"long0":0.7853981633974483,"k0":1,"x0":8500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28409","projName":"tmerc","lat0":0,"long0":0.8901179185171081,"k0":1,"x0":9500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28410","projName":"tmerc","lat0":0,"long0":0.9948376736367679,"k0":1,"x0":10500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28411","projName":"tmerc","lat0":0,"long0":1.0995574287564276,"k0":1,"x0":11500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28412","projName":"tmerc","lat0":0,"long0":1.2042771838760873,"k0":1,"x0":12500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28413","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":13500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28414","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":14500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28415","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":15500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28416","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":16500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28417","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":17500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28418","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":18500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28419","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":19500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28420","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":20500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28421","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":21500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28422","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":22500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28423","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":23500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28424","projName":"tmerc","lat0":0,"long0":2.4609142453120048,"k0":1,"x0":24500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28425","projName":"tmerc","lat0":0,"long0":2.5656340004316642,"k0":1,"x0":25500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28426","projName":"tmerc","lat0":0,"long0":2.670353755551324,"k0":1,"x0":26500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28427","projName":"tmerc","lat0":0,"long0":2.775073510670984,"k0":1,"x0":27500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28428","projName":"tmerc","lat0":0,"long0":2.8797932657906435,"k0":1,"x0":28500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28429","projName":"tmerc","lat0":0,"long0":2.9845130209103035,"k0":1,"x0":29500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28430","projName":"tmerc","lat0":0,"long0":3.0892327760299634,"k0":1,"x0":30500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28431","projName":"tmerc","lat0":0,"long0":-3.0892327760299634,"k0":1,"x0":31500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28432","projName":"tmerc","lat0":0,"long0":-2.9845130209103035,"k0":1,"x0":32500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28462","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28463","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28464","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28465","projName":"tmerc","lat0":0,"long0":0.47123889803846897,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28466","projName":"tmerc","lat0":0,"long0":0.5759586531581288,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28467","projName":"tmerc","lat0":0,"long0":0.6806784082777885,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28468","projName":"tmerc","lat0":0,"long0":0.7853981633974483,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28469","projName":"tmerc","lat0":0,"long0":0.8901179185171081,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28470","projName":"tmerc","lat0":0,"long0":0.9948376736367679,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28471","projName":"tmerc","lat0":0,"long0":1.0995574287564276,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28472","projName":"tmerc","lat0":0,"long0":1.2042771838760873,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28473","projName":"tmerc","lat0":0,"long0":1.3089969389957472,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28474","projName":"tmerc","lat0":0,"long0":1.413716694115407,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28475","projName":"tmerc","lat0":0,"long0":1.5184364492350666,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28476","projName":"tmerc","lat0":0,"long0":1.6231562043547265,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28477","projName":"tmerc","lat0":0,"long0":1.7278759594743862,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28478","projName":"tmerc","lat0":0,"long0":1.8325957145940461,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28479","projName":"tmerc","lat0":0,"long0":1.9373154697137058,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28480","projName":"tmerc","lat0":0,"long0":2.0420352248333655,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28481","projName":"tmerc","lat0":0,"long0":2.1467549799530254,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28482","projName":"tmerc","lat0":0,"long0":2.251474735072685,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28483","projName":"tmerc","lat0":0,"long0":2.356194490192345,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28484","projName":"tmerc","lat0":0,"long0":2.4609142453120048,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28485","projName":"tmerc","lat0":0,"long0":2.5656340004316642,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28486","projName":"tmerc","lat0":0,"long0":2.670353755551324,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28487","projName":"tmerc","lat0":0,"long0":2.775073510670984,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28488","projName":"tmerc","lat0":0,"long0":2.8797932657906435,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28489","projName":"tmerc","lat0":0,"long0":2.9845130209103035,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28490","projName":"tmerc","lat0":0,"long0":3.0892327760299634,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28491","projName":"tmerc","lat0":0,"long0":-3.0892327760299634,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28492","projName":"tmerc","lat0":0,"long0":-2.9845130209103035,"k0":1,"x0":500000,"y0":0,"ellps":"krass","datum_params":[23.92,-141.27,-80.9,0,0.35,0.82,-0.12],"units":"m","no_defs":true},{"EPSG":"28600","projName":"tmerc","lat0":0.42673300211261356,"long0":0.8938994652297625,"k0":0.99999,"x0":200000,"y0":300000,"ellps":"intl","datum_params":[-128.16,-282.42,21.93,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"28991","projName":"sterea","lat0":0.9102967268932393,"long0":0.09403203751960008,"k0":0.9999079,"x0":0,"y0":0,"ellps":"bessel","datum_params":[565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725],"units":"m","no_defs":true},{"EPSG":"28992","projName":"sterea","lat0":0.9102967268932393,"long0":0.09403203751960008,"k0":0.9999079,"x0":155000,"y0":463000,"ellps":"bessel","datum_params":[565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725],"units":"m","no_defs":true},{"EPSG":"29100","projName":"poly","lat0":0,"long0":-0.9424777960769379,"x0":5000000,"y0":10000000,"ellps":"GRS67","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29101","projName":"poly","lat0":0,"long0":-0.9424777960769379,"x0":5000000,"y0":10000000,"ellps":"aust_SA","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29118","projName":"utm","zone":18,"ellps":"GRS67","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29119","projName":"utm","zone":19,"ellps":"GRS67","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29120","projName":"utm","zone":20,"ellps":"GRS67","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29121","projName":"utm","zone":21,"ellps":"GRS67","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29122","projName":"utm","zone":22,"ellps":"GRS67","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29168","projName":"utm","zone":18,"ellps":"aust_SA","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29169","projName":"utm","zone":19,"ellps":"aust_SA","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29170","projName":"utm","zone":20,"ellps":"aust_SA","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29171","projName":"utm","zone":21,"ellps":"aust_SA","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29172","projName":"utm","zone":22,"ellps":"aust_SA","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29177","projName":"utm","zone":17,"utmSouth":true,"ellps":"GRS67","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29178","projName":"utm","zone":18,"utmSouth":true,"ellps":"GRS67","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29179","projName":"utm","zone":19,"utmSouth":true,"ellps":"GRS67","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29180","projName":"utm","zone":20,"utmSouth":true,"ellps":"GRS67","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29181","projName":"utm","zone":21,"utmSouth":true,"ellps":"GRS67","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29182","projName":"utm","zone":22,"utmSouth":true,"ellps":"GRS67","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29183","projName":"utm","zone":23,"utmSouth":true,"ellps":"GRS67","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29184","projName":"utm","zone":24,"utmSouth":true,"ellps":"GRS67","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29185","projName":"utm","zone":25,"utmSouth":true,"ellps":"GRS67","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29187","projName":"utm","zone":17,"utmSouth":true,"ellps":"aust_SA","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29188","projName":"utm","zone":18,"utmSouth":true,"ellps":"aust_SA","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29189","projName":"utm","zone":19,"utmSouth":true,"ellps":"aust_SA","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29190","projName":"utm","zone":20,"utmSouth":true,"ellps":"aust_SA","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29191","projName":"utm","zone":21,"utmSouth":true,"ellps":"aust_SA","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29192","projName":"utm","zone":22,"utmSouth":true,"ellps":"aust_SA","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29193","projName":"utm","zone":23,"utmSouth":true,"ellps":"aust_SA","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29194","projName":"utm","zone":24,"utmSouth":true,"ellps":"aust_SA","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29195","projName":"utm","zone":25,"utmSouth":true,"ellps":"aust_SA","datum_params":[-57,1,-41,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29220","projName":"utm","zone":20,"utmSouth":true,"ellps":"intl","datum_params":[-355,21,72,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29221","projName":"utm","zone":21,"utmSouth":true,"ellps":"intl","datum_params":[-355,21,72,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29333","projName":"utm","zone":33,"utmSouth":true,"ellps":"bess_nam","datum_params":[616,97,-251,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29371","projName":"tmerc","lat0":-0.3839724354387525,"long0":0.19198621771937624,"k0":1,"x0":0,"y0":0,"axis":"wsu","ellps":"bess_nam","datum_params":[616,97,-251,0,0,0,0],"to_meter":1.0000135965,"no_defs":true},{"EPSG":"29373","projName":"tmerc","lat0":-0.3839724354387525,"long0":0.22689280275926285,"k0":1,"x0":0,"y0":0,"axis":"wsu","ellps":"bess_nam","datum_params":[616,97,-251,0,0,0,0],"to_meter":1.0000135965,"no_defs":true},{"EPSG":"29375","projName":"tmerc","lat0":-0.3839724354387525,"long0":0.2617993877991494,"k0":1,"x0":0,"y0":0,"axis":"wsu","ellps":"bess_nam","datum_params":[616,97,-251,0,0,0,0],"to_meter":1.0000135965,"no_defs":true},{"EPSG":"29377","projName":"tmerc","lat0":-0.3839724354387525,"long0":0.29670597283903605,"k0":1,"x0":0,"y0":0,"axis":"wsu","ellps":"bess_nam","datum_params":[616,97,-251,0,0,0,0],"to_meter":1.0000135965,"no_defs":true},{"EPSG":"29379","projName":"tmerc","lat0":-0.3839724354387525,"long0":0.33161255787892263,"k0":1,"x0":0,"y0":0,"axis":"wsu","ellps":"bess_nam","datum_params":[616,97,-251,0,0,0,0],"to_meter":1.0000135965,"no_defs":true},{"EPSG":"29381","projName":"tmerc","lat0":-0.3839724354387525,"long0":0.3665191429188092,"k0":1,"x0":0,"y0":0,"axis":"wsu","ellps":"bess_nam","datum_params":[616,97,-251,0,0,0,0],"to_meter":1.0000135965,"no_defs":true},{"EPSG":"29383","projName":"tmerc","lat0":-0.3839724354387525,"long0":0.4014257279586958,"k0":1,"x0":0,"y0":0,"axis":"wsu","ellps":"bess_nam","datum_params":[616,97,-251,0,0,0,0],"to_meter":1.0000135965,"no_defs":true},{"EPSG":"29385","projName":"tmerc","lat0":-0.3839724354387525,"long0":0.4363323129985824,"k0":1,"x0":0,"y0":0,"axis":"wsu","ellps":"bess_nam","datum_params":[616,97,-251,0,0,0,0],"to_meter":1.0000135965,"no_defs":true},{"EPSG":"29635","projName":"utm","zone":35,"a":"6378249.2","b":"6356515","units":"m","no_defs":true},{"EPSG":"29636","projName":"utm","zone":36,"a":"6378249.2","b":"6356515","units":"m","no_defs":true},{"EPSG":"29700","projName":"omerc","lat0":-0.32986722862692824,"longc":0.7696902001294995,"alpha":0.32986722862692824,"k0":0.9995,"x0":400000,"y0":800000,"gamma":"18.9","ellps":"intl","datum_params":[-189,-242,-91,0,0,0,0],"from_greenwich":0.04079234433198245,"units":"m","no_defs":true},{"EPSG":"29702","projName":"omerc","lat0":-0.32986722862692824,"longc":0.7696902001294995,"alpha":0.32986722862692824,"k0":0.9995,"x0":400000,"y0":800000,"gamma":"18.9","ellps":"intl","datum_params":[-189,-242,-91,0,0,0,0],"from_greenwich":0.04079234433198245,"units":"m","no_defs":true},{"EPSG":"29738","projName":"utm","zone":38,"utmSouth":true,"ellps":"intl","datum_params":[-189,-242,-91,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29739","projName":"utm","zone":39,"utmSouth":true,"ellps":"intl","datum_params":[-189,-242,-91,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29849","projName":"utm","zone":49,"ellps":"evrstSS","datum_params":[-679,669,-48,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29850","projName":"utm","zone":50,"ellps":"evrstSS","datum_params":[-679,669,-48,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29871","projName":"omerc","lat0":0.06981317007977318,"longc":2.007128639793479,"alpha":0.9305366106424757,"k0":0.99984,"x0":590476.8714630401,"y0":442857.653094361,"gamma":"53.13010236111111","ellps":"evrstSS","datum_params":[-679,669,-48,0,0,0,0],"to_meter":20.11676512155263,"no_defs":true},{"EPSG":"29872","projName":"omerc","lat0":0.06981317007977318,"longc":2.007128639793479,"alpha":0.9305366106424757,"k0":0.99984,"x0":590476.872743198,"y0":442857.6545573985,"gamma":"53.13010236111111","ellps":"evrstSS","datum_params":[-679,669,-48,0,0,0,0],"to_meter":0.3047994715386762,"no_defs":true},{"EPSG":"29873","projName":"omerc","lat0":0.06981317007977318,"longc":2.007128639793479,"alpha":0.9305366106424757,"k0":0.99984,"x0":590476.87,"y0":442857.65,"gamma":"53.13010236111111","ellps":"evrstSS","datum_params":[-679,669,-48,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"29900","projName":"tmerc","lat0":0.9337511498169663,"long0":-0.13962634015954636,"k0":1.000035,"x0":200000,"y0":250000,"datumCode":"ire65","units":"m","no_defs":true},{"EPSG":"29901","projName":"tmerc","lat0":0.9337511498169663,"long0":-0.13962634015954636,"k0":1,"x0":200000,"y0":250000,"ellps":"airy","datum_params":[482.5,-130.6,564.6,-1.042,-0.214,-0.631,8.15],"units":"m","no_defs":true},{"EPSG":"29902","projName":"tmerc","lat0":0.9337511498169663,"long0":-0.13962634015954636,"k0":1.000035,"x0":200000,"y0":250000,"datumCode":"ire65","units":"m","no_defs":true},{"EPSG":"29903","projName":"tmerc","lat0":0.9337511498169663,"long0":-0.13962634015954636,"k0":1.000035,"x0":200000,"y0":250000,"ellps":"mod_airy","datum_params":[482.5,-130.6,564.6,-1.042,-0.214,-0.631,8.15],"units":"m","no_defs":true},{"EPSG":"30161","projName":"tmerc","lat0":0.5759586531581288,"long0":2.260201381332657,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30162","projName":"tmerc","lat0":0.5759586531581288,"long0":2.2863813201125716,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30163","projName":"tmerc","lat0":0.6283185307179586,"long0":2.306743494719173,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30164","projName":"tmerc","lat0":0.5759586531581288,"long0":2.3300145514124297,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30165","projName":"tmerc","lat0":0.6283185307179586,"long0":2.344558961845715,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30166","projName":"tmerc","lat0":0.6283185307179586,"long0":2.3736477827122884,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30167","projName":"tmerc","lat0":0.6283185307179586,"long0":2.3940099573188895,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30168","projName":"tmerc","lat0":0.6283185307179586,"long0":2.4172810140121466,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30169","projName":"tmerc","lat0":0.6283185307179586,"long0":2.440552070705403,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30170","projName":"tmerc","lat0":0.6981317007977318,"long0":2.4580053632253467,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30171","projName":"tmerc","lat0":0.767944870877505,"long0":2.447824275922047,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30172","projName":"tmerc","lat0":0.767944870877505,"long0":2.482730860961934,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30173","projName":"tmerc","lat0":0.767944870877505,"long0":2.5176374460018205,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30174","projName":"tmerc","lat0":0.4537856055185257,"long0":2.478367537831948,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30175","projName":"tmerc","lat0":0.4537856055185257,"long0":2.2252947962927703,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30176","projName":"tmerc","lat0":0.4537856055185257,"long0":2.1642082724729685,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30177","projName":"tmerc","lat0":0.4537856055185257,"long0":2.2863813201125716,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30178","projName":"tmerc","lat0":0.3490658503988659,"long0":2.3736477827122884,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30179","projName":"tmerc","lat0":0.4537856055185257,"long0":2.6878070480712677,"k0":0.9999,"x0":0,"y0":0,"ellps":"bessel","datum_params":[-146.414,507.337,680.507,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30200","projName":"cass","lat0":0.18224146272907463,"long0":-1.0704686078898555,"x0":86501.46392052,"y0":65379.0134283,"a":"6378293.645208759","b":"6356617.987679838","datum_params":[-61.702,284.488,472.052,0,0,0,0],"to_meter":0.201166195164,"no_defs":true},{"EPSG":"30339","projName":"utm","zone":39,"ellps":"helmert","units":"m","no_defs":true},{"EPSG":"30340","projName":"utm","zone":40,"ellps":"helmert","units":"m","no_defs":true},{"EPSG":"30491","projName":"lcc","lat1":0.6283185307179586,"lat0":0.6283185307179586,"long0":0.0471238898038469,"k0":0.999625544,"x0":500000,"y0":300000,"a":"6378249.2","b":"6356515","datum_params":[-73,-247,227,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30492","projName":"lcc","lat1":0.5811946409141117,"lat0":0.5811946409141117,"long0":0.0471238898038469,"k0":0.999625769,"x0":500000,"y0":300000,"a":"6378249.2","b":"6356515","datum_params":[-73,-247,227,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"30493","projName":"lcc","lat1":0.6283185307179586,"lat0":0.6283185307179586,"long0":0.0471238898038469,"k0":0.999625544,"x0":500000,"y0":300000,"a":"6378249.2","b":"6356515","units":"m","no_defs":true},{"EPSG":"30494","projName":"lcc","lat1":0.5811946409141117,"lat0":0.5811946409141117,"long0":0.0471238898038469,"k0":0.999625769,"x0":500000,"y0":300000,"a":"6378249.2","b":"6356515","units":"m","no_defs":true},{"EPSG":"30729","projName":"utm","zone":29,"ellps":"clrk80","datum_params":[-209.362,-87.8162,404.62,0.0046,3.4784,0.5805,-1.4547],"units":"m","no_defs":true},{"EPSG":"30730","projName":"utm","zone":30,"ellps":"clrk80","datum_params":[-209.362,-87.8162,404.62,0.0046,3.4784,0.5805,-1.4547],"units":"m","no_defs":true},{"EPSG":"30731","projName":"utm","zone":31,"ellps":"clrk80","datum_params":[-209.362,-87.8162,404.62,0.0046,3.4784,0.5805,-1.4547],"units":"m","no_defs":true},{"EPSG":"30732","projName":"utm","zone":32,"ellps":"clrk80","datum_params":[-209.362,-87.8162,404.62,0.0046,3.4784,0.5805,-1.4547],"units":"m","no_defs":true},{"EPSG":"30791","projName":"lcc","lat1":0.6283185307179586,"lat0":0.6283185307179586,"long0":0.0471238898038469,"k0":0.999625544,"x0":500135,"y0":300090,"ellps":"clrk80","datum_params":[-209.362,-87.8162,404.62,0.0046,3.4784,0.5805,-1.4547],"units":"m","no_defs":true},{"EPSG":"30792","projName":"lcc","lat1":0.5811946409141117,"lat0":0.5811946409141117,"long0":0.0471238898038469,"k0":0.999625769,"x0":500135,"y0":300090,"ellps":"clrk80","datum_params":[-209.362,-87.8162,404.62,0.0046,3.4784,0.5805,-1.4547],"units":"m","no_defs":true},{"EPSG":"30800","projName":"tmerc","lat0":0,"long0":0.27590649629207475,"k0":1,"x0":1500000,"y0":0,"ellps":"bessel","units":"m","no_defs":true},{"EPSG":"31028","projName":"utm","zone":28,"a":"6378249.2","b":"6356515","units":"m","no_defs":true},{"EPSG":"31121","projName":"utm","zone":21,"ellps":"intl","datum_params":[-265,120,-358,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31154","projName":"tmerc","lat0":0,"long0":-0.9424777960769379,"k0":0.9996,"x0":500000,"y0":0,"ellps":"intl","datum_params":[-265,120,-358,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31170","projName":"tmerc","lat0":0,"long0":-0.9718575051521757,"k0":0.9996,"x0":500000,"y0":0,"ellps":"intl","datum_params":[-265,120,-358,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31171","projName":"tmerc","lat0":0,"long0":-0.9718575051521757,"k0":0.9999,"x0":500000,"y0":0,"ellps":"intl","datum_params":[-265,120,-358,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31251","projName":"tmerc","lat0":0,"long0":0.4886921905584123,"k0":1,"x0":0,"y0":-5000000,"ellps":"bessel","datum_params":[682,-203,480,0,0,0,0],"from_greenwich":-0.30834150118567066,"units":"m","no_defs":true},{"EPSG":"31252","projName":"tmerc","lat0":0,"long0":0.5410520681182421,"k0":1,"x0":0,"y0":-5000000,"ellps":"bessel","datum_params":[682,-203,480,0,0,0,0],"from_greenwich":-0.30834150118567066,"units":"m","no_defs":true},{"EPSG":"31253","projName":"tmerc","lat0":0,"long0":0.5934119456780721,"k0":1,"x0":0,"y0":-5000000,"ellps":"bessel","datum_params":[682,-203,480,0,0,0,0],"from_greenwich":-0.30834150118567066,"units":"m","no_defs":true},{"EPSG":"31254","projName":"tmerc","lat0":0,"long0":0.18035068937274734,"k0":1,"x0":0,"y0":-5000000,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31255","projName":"tmerc","lat0":0,"long0":0.23271056693257722,"k0":1,"x0":0,"y0":-5000000,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31256","projName":"tmerc","lat0":0,"long0":0.2850704444924071,"k0":1,"x0":0,"y0":-5000000,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31257","projName":"tmerc","lat0":0,"long0":0.18035068937274734,"k0":1,"x0":150000,"y0":-5000000,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31258","projName":"tmerc","lat0":0,"long0":0.23271056693257722,"k0":1,"x0":450000,"y0":-5000000,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31259","projName":"tmerc","lat0":0,"long0":0.2850704444924071,"k0":1,"x0":750000,"y0":-5000000,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31265","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":5500000,"y0":0,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31266","projName":"tmerc","lat0":0,"long0":0.3141592653589793,"k0":1,"x0":6500000,"y0":0,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31267","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":1,"x0":7500000,"y0":0,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31268","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":1,"x0":8500000,"y0":0,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31275","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":0.9999,"x0":5500000,"y0":0,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31276","projName":"tmerc","lat0":0,"long0":0.3141592653589793,"k0":0.9999,"x0":6500000,"y0":0,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31277","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":0.9999,"x0":7500000,"y0":0,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31278","projName":"tmerc","lat0":0,"long0":0.3665191429188092,"k0":0.9999,"x0":7500000,"y0":0,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31279","projName":"tmerc","lat0":0,"long0":0.4188790204786391,"k0":0.9999,"x0":8500000,"y0":0,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31281","projName":"tmerc","lat0":0,"long0":0.4886921905584123,"k0":1,"x0":0,"y0":0,"ellps":"bessel","datum_params":[682,-203,480,0,0,0,0],"from_greenwich":-0.30834150118567066,"units":"m","no_defs":true},{"EPSG":"31282","projName":"tmerc","lat0":0,"long0":0.5410520681182421,"k0":1,"x0":0,"y0":0,"ellps":"bessel","datum_params":[682,-203,480,0,0,0,0],"from_greenwich":-0.30834150118567066,"units":"m","no_defs":true},{"EPSG":"31283","projName":"tmerc","lat0":0,"long0":0.5934119456780721,"k0":1,"x0":0,"y0":0,"ellps":"bessel","datum_params":[682,-203,480,0,0,0,0],"from_greenwich":-0.30834150118567066,"units":"m","no_defs":true},{"EPSG":"31284","projName":"tmerc","lat0":0,"long0":0.18035068937274734,"k0":1,"x0":150000,"y0":0,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31285","projName":"tmerc","lat0":0,"long0":0.23271056693257722,"k0":1,"x0":450000,"y0":0,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31286","projName":"tmerc","lat0":0,"long0":0.2850704444924071,"k0":1,"x0":750000,"y0":0,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31287","projName":"lcc","lat1":0.8552113334772214,"lat2":0.8028514559173916,"lat0":0.8290313946973066,"long0":0.23271056693257722,"x0":400000,"y0":400000,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31288","projName":"tmerc","lat0":0,"long0":0.4886921905584123,"k0":1,"x0":150000,"y0":0,"ellps":"bessel","datum_params":[682,-203,480,0,0,0,0],"from_greenwich":-0.30834150118567066,"units":"m","no_defs":true},{"EPSG":"31289","projName":"tmerc","lat0":0,"long0":0.5410520681182421,"k0":1,"x0":450000,"y0":0,"ellps":"bessel","datum_params":[682,-203,480,0,0,0,0],"from_greenwich":-0.30834150118567066,"units":"m","no_defs":true},{"EPSG":"31290","projName":"tmerc","lat0":0,"long0":0.5934119456780721,"k0":1,"x0":750000,"y0":0,"ellps":"bessel","datum_params":[682,-203,480,0,0,0,0],"from_greenwich":-0.30834150118567066,"units":"m","no_defs":true},{"EPSG":"31291","projName":"tmerc","lat0":0,"long0":0.4886921905584123,"k0":1,"x0":0,"y0":0,"ellps":"bessel","datum_params":[682,-203,480,0,0,0,0],"from_greenwich":-0.30834150118567066,"units":"m","no_defs":true},{"EPSG":"31292","projName":"tmerc","lat0":0,"long0":0.5410520681182421,"k0":1,"x0":0,"y0":0,"ellps":"bessel","datum_params":[682,-203,480,0,0,0,0],"from_greenwich":-0.30834150118567066,"units":"m","no_defs":true},{"EPSG":"31293","projName":"tmerc","lat0":0,"long0":0.5934119456780721,"k0":1,"x0":0,"y0":0,"ellps":"bessel","datum_params":[682,-203,480,0,0,0,0],"from_greenwich":-0.30834150118567066,"units":"m","no_defs":true},{"EPSG":"31294","projName":"tmerc","lat0":0,"long0":0.18035068937274734,"k0":1,"x0":150000,"y0":0,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31295","projName":"tmerc","lat0":0,"long0":0.23271056693257722,"k0":1,"x0":450000,"y0":0,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31296","projName":"tmerc","lat0":0,"long0":0.2850704444924071,"k0":1,"x0":750000,"y0":0,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31297","projName":"lcc","lat1":0.8552113334772214,"lat2":0.8028514559173916,"lat0":0.8290313946973066,"long0":0.23271056693257722,"x0":400000,"y0":400000,"datumCode":"hermannskogel","units":"m","no_defs":true},{"EPSG":"31300","projName":"lcc","lat1":0.8697557439105077,"lat2":0.8930268006037652,"lat0":1.5707963267948966,"long0":0.07604294346370492,"x0":150000.01256,"y0":5400088.4378,"ellps":"intl","datum_params":[-106.869,52.2978,-103.724,0.3366,-0.457,1.8422,-1.2747],"units":"m","no_defs":true},{"EPSG":"31370","projName":"lcc","lat1":0.8930268104939643,"lat2":0.8697557538007067,"lat0":1.5707963267948966,"long0":0.0762270223702854,"x0":150000.013,"y0":5400088.438,"ellps":"intl","datum_params":[-106.869,52.2978,-103.724,0.3366,-0.457,1.8422,-1.2747],"units":"m","no_defs":true},{"EPSG":"31461","projName":"tmerc","lat0":0,"long0":0.05235987755982989,"k0":1,"x0":1500000,"y0":0,"datumCode":"potsdam","units":"m","no_defs":true},{"EPSG":"31462","projName":"tmerc","lat0":0,"long0":0.10471975511965978,"k0":1,"x0":2500000,"y0":0,"datumCode":"potsdam","units":"m","no_defs":true},{"EPSG":"31463","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":1,"x0":3500000,"y0":0,"datumCode":"potsdam","units":"m","no_defs":true},{"EPSG":"31464","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":1,"x0":4500000,"y0":0,"datumCode":"potsdam","units":"m","no_defs":true},{"EPSG":"31465","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":5500000,"y0":0,"datumCode":"potsdam","units":"m","no_defs":true},{"EPSG":"31466","projName":"tmerc","lat0":0,"long0":0.10471975511965978,"k0":1,"x0":2500000,"y0":0,"datumCode":"potsdam","units":"m","no_defs":true},{"EPSG":"31467","projName":"tmerc","lat0":0,"long0":0.15707963267948966,"k0":1,"x0":3500000,"y0":0,"datumCode":"potsdam","units":"m","no_defs":true},{"EPSG":"31468","projName":"tmerc","lat0":0,"long0":0.20943951023931956,"k0":1,"x0":4500000,"y0":0,"datumCode":"potsdam","units":"m","no_defs":true},{"EPSG":"31469","projName":"tmerc","lat0":0,"long0":0.2617993877991494,"k0":1,"x0":5500000,"y0":0,"datumCode":"potsdam","units":"m","no_defs":true},{"EPSG":"31528","projName":"utm","zone":28,"a":"6378249.2","b":"6356515","datum_params":[-23,259,-9,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31529","projName":"utm","zone":29,"a":"6378249.2","b":"6356515","datum_params":[-23,259,-9,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31600","projName":"sterea","lat0":0.8011061266653973,"long0":0.44318213496145975,"k0":0.9996667,"x0":500000,"y0":500000,"ellps":"intl","datum_params":[103.25,-100.4,-307.19,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31700","projName":"sterea","lat0":0.8028514559173916,"long0":0.4363323129985824,"k0":0.99975,"x0":500000,"y0":500000,"ellps":"krass","datum_params":[28,-121,-77,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31838","projName":"utm","zone":38,"ellps":"WGS84","datum_params":[-3.2,-5.7,2.8,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31839","projName":"utm","zone":39,"ellps":"WGS84","datum_params":[-3.2,-5.7,2.8,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31900","projName":"tmerc","lat0":0,"long0":0.8377580409572782,"k0":0.9996,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[-20.8,11.3,2.4,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31901","projName":"tmerc","lat0":0,"long0":0.8377580409572782,"k0":1,"x0":500000,"y0":0,"ellps":"GRS80","datum_params":[-20.8,11.3,2.4,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31965","projName":"utm","zone":11,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31966","projName":"utm","zone":12,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31967","projName":"utm","zone":13,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31968","projName":"utm","zone":14,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31969","projName":"utm","zone":15,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31970","projName":"utm","zone":16,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31971","projName":"utm","zone":17,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31972","projName":"utm","zone":18,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31973","projName":"utm","zone":19,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31974","projName":"utm","zone":20,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31975","projName":"utm","zone":21,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31976","projName":"utm","zone":22,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31977","projName":"utm","zone":17,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31978","projName":"utm","zone":18,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31979","projName":"utm","zone":19,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31980","projName":"utm","zone":20,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31981","projName":"utm","zone":21,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31982","projName":"utm","zone":22,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31983","projName":"utm","zone":23,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31984","projName":"utm","zone":24,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31985","projName":"utm","zone":25,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31986","projName":"utm","zone":17,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31987","projName":"utm","zone":18,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31988","projName":"utm","zone":19,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31989","projName":"utm","zone":20,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31990","projName":"utm","zone":21,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31991","projName":"utm","zone":22,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31992","projName":"utm","zone":17,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31993","projName":"utm","zone":18,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31994","projName":"utm","zone":19,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31995","projName":"utm","zone":20,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31996","projName":"utm","zone":21,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31997","projName":"utm","zone":22,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31998","projName":"utm","zone":23,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"31999","projName":"utm","zone":24,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"32000","projName":"utm","zone":25,"utmSouth":true,"ellps":"GRS80","datum_params":[0,0,0,0,0,0,0],"units":"m","no_defs":true},{"EPSG":"32001","projName":"lcc","lat1":0.8502662339299042,"lat2":0.8351400470792867,"lat0":0.8203047484373349,"long0":-1.911135530933791,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32002","projName":"lcc","lat1":0.8357218234966182,"lat2":0.8107054375513661,"lat0":0.7999425738307345,"long0":-1.911135530933791,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32003","projName":"lcc","lat1":0.8098327729253689,"lat2":0.7830710577281226,"lat0":0.767944870877505,"long0":-1.911135530933791,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32005","projName":"lcc","lat1":0.730420291959627,"lat2":0.7472918080622388,"lat0":0.7214027574909897,"long0":-1.7453292519943295,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32006","projName":"lcc","lat1":0.703076800345049,"lat2":0.7280931862903012,"lat0":0.6923139366244172,"long0":-1.736602605734358,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32007","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.017309727096779,"k0":0.9999,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32008","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.0362174606600516,"k0":0.9999,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32009","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.0696696046566085,"k0":0.9999,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32010","projName":"tmerc","lat0":0.7417649320975901,"long0":-1.2508192972626029,"k0":0.999966667,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32011","projName":"tmerc","lat0":0.6777695261911315,"long0":-1.3031791748224328,"k0":0.999975,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32012","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.8209601862474165,"k0":0.999909091,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32013","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.8544123302439752,"k0":0.9999,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32014","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.882046710067218,"k0":0.999916667,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32015","projName":"tmerc","lat0":0.6981317007977318,"long0":-1.2973614106491183,"k0":0.999966667,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32016","projName":"tmerc","lat0":0.6981317007977318,"long0":-1.3366313188189907,"k0":0.9999375,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32017","projName":"tmerc","lat0":0.6981317007977318,"long0":-1.3715379038588773,"k0":0.9999375,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32018","projName":"lcc","lat1":0.7161667697350065,"lat2":0.7097672291443605,"lat0":0.7068583470577035,"long0":-1.2915436464758039,"x0":304800.6096012192,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32019","projName":"lcc","lat1":0.5992297098513867,"lat2":0.6312274128046157,"lat0":0.5890486225480862,"long0":-1.3788101090755203,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32020","projName":"lcc","lat1":0.8278678418626436,"lat2":0.8505571221385698,"lat0":0.8203047484373349,"long0":-1.7540558982543013,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32021","projName":"lcc","lat1":0.8060512262127145,"lat2":0.8287405064886407,"lat0":0.797033691744077,"long0":-1.7540558982543013,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32022","projName":"lcc","lat1":0.7056947942230405,"lat2":0.7278022980816354,"lat0":0.6923139366244172,"long0":-1.4398966328953218,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32023","projName":"lcc","lat1":0.6760241969391368,"lat2":0.6987134772150633,"lat0":0.6632251157578453,"long0":-1.4398966328953218,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32024","projName":"lcc","lat1":0.6207554372926499,"lat2":0.6416993883165819,"lat0":0.6108652381980153,"long0":-1.710422666954443,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32025","projName":"lcc","lat1":0.5922483928434091,"lat2":0.6149376731193353,"lat0":0.5817764173314434,"long0":-1.710422666954443,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32026","projName":"lcc","lat1":0.7737626350508195,"lat2":0.8028514559173916,"lat0":0.7621271067041904,"long0":-2.1031217486531673,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32027","projName":"lcc","lat1":0.738856050010933,"lat2":0.767944870877505,"lat0":0.7272205216643038,"long0":-2.1031217486531673,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32028","projName":"lcc","lat1":0.713548775857015,"lat2":0.7321656212116213,"lat0":0.7010405828843889,"long0":-1.3569934934255912,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32029","projName":"lcc","lat1":0.6969681479630688,"lat2":0.7120943348136864,"lat0":0.6864961724511032,"long0":-1.3569934934255912,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32030","projName":"tmerc","lat0":0.7170394343610039,"long0":-1.2479104151759457,"k0":0.9999938,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32031","projName":"lcc","lat1":0.5893395107567521,"lat2":0.6102834617806839,"lat0":0.5759586531581288,"long0":-1.413716694115407,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32033","projName":"lcc","lat1":0.5643231248115,"lat2":0.5875941815047574,"lat0":0.5555964785515282,"long0":-1.413716694115407,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32034","projName":"lcc","lat1":0.7752170760941479,"lat2":0.7973245799527429,"lat0":0.765035988790848,"long0":-1.7453292519943295,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32035","projName":"lcc","lat1":0.7475826962709047,"lat2":0.7749261878854823,"lat0":0.738856050010933,"long0":-1.7511470161676435,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32036","projName":"lcc","lat1":0.6152285613280012,"lat2":0.6355907359346015,"lat0":0.6050474740247007,"long0":-1.5009831567151235,"x0":30480.06096012192,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32037","projName":"lcc","lat1":0.6047565858160352,"lat2":0.6315183010132815,"lat0":0.5934119456780721,"long0":-1.7715091907742444,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32038","projName":"lcc","lat1":0.5608324663075113,"lat2":0.5928301692607406,"lat0":0.5526875964648711,"long0":-1.7016960206944713,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32039","projName":"lcc","lat1":0.525634993058959,"lat2":0.5564691431775254,"lat0":0.5177810114249846,"long0":-1.7511470161676435,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32040","projName":"lcc","lat1":0.4953826193577238,"lat2":0.5285438751456161,"lat0":0.485783308471755,"long0":-1.7278759594743862,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32041","projName":"lcc","lat1":0.456694487605183,"lat2":0.485783308471755,"lat0":0.44796784134521134,"long0":-1.7191493132144147,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32042","projName":"lcc","lat1":0.7106398937703579,"lat2":0.729256739124964,"lat0":0.7039494649710464,"long0":-1.9460421159736774,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32043","projName":"lcc","lat1":0.6809692964864543,"lat2":0.7094763409356949,"lat0":0.6690428799311599,"long0":-1.9460421159736774,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32044","projName":"lcc","lat1":0.6495533699505563,"lat2":0.6693337681398254,"lat0":0.6399540590645874,"long0":-1.9460421159736774,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32045","projName":"tmerc","lat0":0.7417649320975901,"long0":-1.265363707695889,"k0":0.999964286,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32046","projName":"lcc","lat1":0.6638068921751766,"lat2":0.6841690667817772,"lat0":0.6574073515845307,"long0":-1.3700834628155487,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32047","projName":"lcc","lat1":0.6416993883165819,"lat2":0.6626433393405138,"lat0":0.6341362948912732,"long0":-1.3700834628155487,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32048","projName":"lcc","lat1":0.8290313946973066,"lat2":0.8505571221385698,"lat0":0.8203047484373349,"long0":-2.108939512826481,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32049","projName":"lcc","lat1":0.7999425738307345,"lat2":0.8261225126106495,"lat0":0.7912159275707629,"long0":-2.1031217486531673,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32050","projName":"lcc","lat1":0.6806784082777885,"lat2":0.7024950239277177,"lat0":0.6719517620178169,"long0":-1.387536755335492,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32051","projName":"lcc","lat1":0.6542075812892078,"lat2":0.6786421908171285,"lat0":0.6457718232379019,"long0":-1.413716694115407,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32052","projName":"lcc","lat1":0.7952883624920829,"lat2":0.8162323135160149,"lat0":0.7883070454841054,"long0":-1.5707963267948966,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32053","projName":"lcc","lat1":0.7723081940074908,"lat2":0.7941248096574199,"lat0":0.765035988790848,"long0":-1.5707963267948966,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32054","projName":"lcc","lat1":0.74583736701891,"lat2":0.7691084237121679,"lat0":0.7330382858376184,"long0":-1.5707963267948966,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32055","projName":"tmerc","lat0":0.7097672291443605,"long0":-1.8355045966807038,"k0":0.999941177,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32056","projName":"tmerc","lat0":0.7097672291443605,"long0":-1.8733200638072465,"k0":0.999941177,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32057","projName":"tmerc","lat0":0.7097672291443605,"long0":-1.8980455615438334,"k0":0.999941177,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32058","projName":"tmerc","lat0":0.7097672291443605,"long0":-1.9213166182370904,"k0":0.999941177,"x0":152400.3048006096,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32061","projName":"lcc","lat1":0.2935062025437131,"lat0":0.2935062025437131,"long0":-1.576614090968211,"k0":0.99992226,"x0":500000,"y0":292209.579,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"32062","projName":"lcc","lat1":0.26005405854715513,"lat0":0.26005405854715513,"long0":-1.576614090968211,"k0":0.99989906,"x0":500000,"y0":325992.681,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"32064","projName":"tmerc","lat0":0,"long0":-1.7278759594743862,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32065","projName":"tmerc","lat0":0,"long0":-1.6231562043547265,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32066","projName":"tmerc","lat0":0,"long0":-1.5184364492350666,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32067","projName":"tmerc","lat0":0,"long0":-1.413716694115407,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32074","projName":"tmerc","lat0":0,"long0":-1.7278759594743862,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32075","projName":"tmerc","lat0":0,"long0":-1.6231562043547265,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32076","projName":"tmerc","lat0":0,"long0":-1.5184364492350666,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32077","projName":"tmerc","lat0":0,"long0":-1.413716694115407,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32081","projName":"tmerc","lat0":0,"long0":-0.9250245035569946,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"32082","projName":"tmerc","lat0":0,"long0":-0.9773843811168246,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"32083","projName":"tmerc","lat0":0,"long0":-1.0210176124166828,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"32084","projName":"tmerc","lat0":0,"long0":-1.0733774899765127,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"32085","projName":"tmerc","lat0":0,"long0":-1.1257373675363425,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"32086","projName":"tmerc","lat0":0,"long0":-1.1780972450961724,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"32098","projName":"lcc","lat1":1.0471975511965976,"lat2":0.8028514559173916,"lat0":0.767944870877505,"long0":-1.1955505376161157,"x0":0,"y0":0,"datumCode":"NAD27","units":"m","no_defs":true},{"EPSG":"32099","projName":"lcc","lat1":0.485783308471755,"lat2":0.456694487605183,"lat0":0.44796784134521134,"long0":-1.5940673834881542,"x0":609601.2192024384,"y0":0,"datumCode":"NAD27","units":"us-ft","no_defs":true},{"EPSG":"32100","projName":"lcc","lat1":0.8552113334772214,"lat2":0.7853981633974483,"lat0":0.7723081940074908,"long0":-1.911135530933791,"x0":600000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32104","projName":"lcc","lat1":0.7504915783575618,"lat2":0.6981317007977318,"lat0":0.6952228187110747,"long0":-1.7453292519943295,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32107","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.017309727096779,"k0":0.9999,"x0":200000,"y0":8000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32108","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.0362174606600516,"k0":0.9999,"x0":500000,"y0":6000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32109","projName":"tmerc","lat0":0.6065019150680295,"long0":-2.0696696046566085,"k0":0.9999,"x0":800000,"y0":4000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32110","projName":"tmerc","lat0":0.7417649320975901,"long0":-1.2508192972626029,"k0":0.999966667,"x0":300000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32111","projName":"tmerc","lat0":0.6777695261911315,"long0":-1.3002702927357754,"k0":0.9999,"x0":150000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32112","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.8209601862474165,"k0":0.999909091,"x0":165000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32113","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.8544123302439752,"k0":0.9999,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32114","projName":"tmerc","lat0":0.5410520681182421,"long0":-1.882046710067218,"k0":0.999916667,"x0":830000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32115","projName":"tmerc","lat0":0.6777695261911315,"long0":-1.3002702927357754,"k0":0.9999,"x0":150000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32116","projName":"tmerc","lat0":0.6981317007977318,"long0":-1.3366313188189907,"k0":0.9999375,"x0":250000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32117","projName":"tmerc","lat0":0.6981317007977318,"long0":-1.3715379038588773,"k0":0.9999375,"x0":350000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32118","projName":"lcc","lat1":0.7161667697350065,"lat2":0.7097672291443605,"lat0":0.7010405828843889,"long0":-1.2915436464758039,"x0":300000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32119","projName":"lcc","lat1":0.6312274128046157,"lat2":0.5992297098513867,"lat0":0.5890486225480862,"long0":-1.3788101090755203,"x0":609601.22,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32120","projName":"lcc","lat1":0.8505571221385698,"lat2":0.8278678418626436,"lat0":0.8203047484373349,"long0":-1.7540558982543013,"x0":600000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32121","projName":"lcc","lat1":0.8287405064886407,"lat2":0.8060512262127145,"lat0":0.797033691744077,"long0":-1.7540558982543013,"x0":600000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32122","projName":"lcc","lat1":0.7278022980816354,"lat2":0.7056947942230405,"lat0":0.6923139366244172,"long0":-1.4398966328953218,"x0":600000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32123","projName":"lcc","lat1":0.6987134772150633,"lat2":0.6760241969391368,"lat0":0.6632251157578453,"long0":-1.4398966328953218,"x0":600000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32124","projName":"lcc","lat1":0.6416993883165819,"lat2":0.6207554372926499,"lat0":0.6108652381980153,"long0":-1.710422666954443,"x0":600000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32125","projName":"lcc","lat1":0.6149376731193353,"lat2":0.5922483928434091,"lat0":0.5817764173314434,"long0":-1.710422666954443,"x0":600000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32126","projName":"lcc","lat1":0.8028514559173916,"lat2":0.7737626350508195,"lat0":0.7621271067041904,"long0":-2.1031217486531673,"x0":2500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32127","projName":"lcc","lat1":0.767944870877505,"lat2":0.738856050010933,"lat0":0.7272205216643038,"long0":-2.1031217486531673,"x0":1500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32128","projName":"lcc","lat1":0.7321656212116213,"lat2":0.713548775857015,"lat0":0.7010405828843889,"long0":-1.3569934934255912,"x0":600000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32129","projName":"lcc","lat1":0.7150032169003437,"lat2":0.6969681479630688,"lat0":0.6864961724511032,"long0":-1.3569934934255912,"x0":600000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32130","projName":"tmerc","lat0":0.7170394343610039,"long0":-1.2479104151759457,"k0":0.99999375,"x0":100000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32133","projName":"lcc","lat1":0.6079563561113583,"lat2":0.5672320068981571,"lat0":0.5555964785515282,"long0":-1.413716694115407,"x0":609600,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32134","projName":"lcc","lat1":0.7973245799527429,"lat2":0.7752170760941479,"lat0":0.765035988790848,"long0":-1.7453292519943295,"x0":600000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32135","projName":"lcc","lat1":0.7749261878854823,"lat2":0.7475826962709047,"lat0":0.738856050010933,"long0":-1.7511470161676435,"x0":600000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32136","projName":"lcc","lat1":0.6355907359346015,"lat2":0.6152285613280012,"lat0":0.5992297098513867,"long0":-1.5009831567151235,"x0":600000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32137","projName":"lcc","lat1":0.6315183010132815,"lat2":0.6047565858160352,"lat0":0.5934119456780721,"long0":-1.7715091907742444,"x0":200000,"y0":1000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32138","projName":"lcc","lat1":0.5928301692607406,"lat2":0.5608324663075113,"lat0":0.5526875964648711,"long0":-1.7191493132144147,"x0":600000,"y0":2000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32139","projName":"lcc","lat1":0.5564691431775254,"lat2":0.525634993058959,"lat0":0.5177810114249846,"long0":-1.7511470161676435,"x0":700000,"y0":3000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32140","projName":"lcc","lat1":0.5285438751456161,"lat2":0.4953826193577238,"lat0":0.485783308471755,"long0":-1.7278759594743862,"x0":600000,"y0":4000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32141","projName":"lcc","lat1":0.485783308471755,"lat2":0.456694487605183,"lat0":0.44796784134521134,"long0":-1.7191493132144147,"x0":300000,"y0":5000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32142","projName":"lcc","lat1":0.729256739124964,"lat2":0.7106398937703579,"lat0":0.7039494649710464,"long0":-1.9460421159736774,"x0":500000,"y0":1000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32143","projName":"lcc","lat1":0.7094763409356949,"lat2":0.6809692964864543,"lat0":0.6690428799311599,"long0":-1.9460421159736774,"x0":500000,"y0":2000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32144","projName":"lcc","lat1":0.6693337681398254,"lat2":0.6495533699505563,"lat0":0.6399540590645874,"long0":-1.9460421159736774,"x0":500000,"y0":3000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32145","projName":"tmerc","lat0":0.7417649320975901,"long0":-1.265363707695889,"k0":0.999964286,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32146","projName":"lcc","lat1":0.6841690667817772,"lat2":0.6638068921751766,"lat0":0.6574073515845307,"long0":-1.3700834628155487,"x0":3500000,"y0":2000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32147","projName":"lcc","lat1":0.6626433393405138,"lat2":0.6416993883165819,"lat0":0.6341362948912732,"long0":-1.3700834628155487,"x0":3500000,"y0":1000000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32148","projName":"lcc","lat1":0.8505571221385698,"lat2":0.8290313946973066,"lat0":0.8203047484373349,"long0":-2.108939512826481,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32149","projName":"lcc","lat1":0.8261225126106495,"lat2":0.7999425738307345,"lat0":0.7912159275707629,"long0":-2.1031217486531673,"x0":500000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32150","projName":"lcc","lat1":0.7024950239277177,"lat2":0.6806784082777885,"lat0":0.6719517620178169,"long0":-1.387536755335492,"x0":600000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32151","projName":"lcc","lat1":0.6786421908171285,"lat2":0.6542075812892078,"lat0":0.6457718232379019,"long0":-1.413716694115407,"x0":600000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32152","projName":"lcc","lat1":0.8162323135160149,"lat2":0.7952883624920829,"lat0":0.7883070454841054,"long0":-1.5707963267948966,"x0":600000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32153","projName":"lcc","lat1":0.7941248096574199,"lat2":0.7723081940074908,"lat0":0.765035988790848,"long0":-1.5707963267948966,"x0":600000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32154","projName":"lcc","lat1":0.7691084237121679,"lat2":0.74583736701891,"lat0":0.7330382858376184,"long0":-1.5707963267948966,"x0":600000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32155","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.8355045966807038,"k0":0.9999375,"x0":200000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32156","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.8733200638072465,"k0":0.9999375,"x0":400000,"y0":100000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32157","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.8980455615438334,"k0":0.9999375,"x0":600000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32158","projName":"tmerc","lat0":0.7068583470577035,"long0":-1.9213166182370904,"k0":0.9999375,"x0":800000,"y0":100000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32161","projName":"lcc","lat1":0.321722358784288,"lat2":0.31474104177631074,"lat0":0.311250383272322,"long0":-1.1594803997415664,"x0":200000,"y0":200000,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32164","projName":"tmerc","lat0":0,"long0":-1.7278759594743862,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"32165","projName":"tmerc","lat0":0,"long0":-1.6231562043547265,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"32166","projName":"tmerc","lat0":0,"long0":-1.5184364492350666,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"32167","projName":"tmerc","lat0":0,"long0":-1.413716694115407,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"NAD83","units":"us-ft","no_defs":true},{"EPSG":"32180","projName":"tmerc","lat0":0,"long0":-0.9686577348568529,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32181","projName":"tmerc","lat0":0,"long0":-0.9250245035569946,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32182","projName":"tmerc","lat0":0,"long0":-0.9773843811168246,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32183","projName":"tmerc","lat0":0,"long0":-1.0210176124166828,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32184","projName":"tmerc","lat0":0,"long0":-1.0733774899765127,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32185","projName":"tmerc","lat0":0,"long0":-1.1257373675363425,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32186","projName":"tmerc","lat0":0,"long0":-1.1780972450961724,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32187","projName":"tmerc","lat0":0,"long0":-1.2304571226560024,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32188","projName":"tmerc","lat0":0,"long0":-1.2828170002158321,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32189","projName":"tmerc","lat0":0,"long0":-1.335176877775662,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32190","projName":"tmerc","lat0":0,"long0":-1.387536755335492,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32191","projName":"tmerc","lat0":0,"long0":-1.4398966328953218,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32192","projName":"tmerc","lat0":0,"long0":-1.413716694115407,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32193","projName":"tmerc","lat0":0,"long0":-1.4660765716752369,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32194","projName":"tmerc","lat0":0,"long0":-1.5184364492350666,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32195","projName":"tmerc","lat0":0,"long0":-1.5707963267948966,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32196","projName":"tmerc","lat0":0,"long0":-1.6231562043547265,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32197","projName":"tmerc","lat0":0,"long0":-1.6755160819145565,"k0":0.9999,"x0":304800,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32198","projName":"lcc","lat1":1.0471975511965976,"lat2":0.8028514559173916,"lat0":0.767944870877505,"long0":-1.1955505376161157,"x0":0,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32199","projName":"lcc","lat1":0.485783308471755,"lat2":0.456694487605183,"lat0":0.44505895925855404,"long0":-1.5940673834881542,"x0":1000000,"y0":0,"datumCode":"NAD83","units":"m","no_defs":true},{"EPSG":"32201","projName":"utm","zone":1,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32202","projName":"utm","zone":2,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32203","projName":"utm","zone":3,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32204","projName":"utm","zone":4,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32205","projName":"utm","zone":5,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32206","projName":"utm","zone":6,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32207","projName":"utm","zone":7,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32208","projName":"utm","zone":8,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32209","projName":"utm","zone":9,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32210","projName":"utm","zone":10,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32211","projName":"utm","zone":11,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32212","projName":"utm","zone":12,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32213","projName":"utm","zone":13,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32214","projName":"utm","zone":14,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32215","projName":"utm","zone":15,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32216","projName":"utm","zone":16,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32217","projName":"utm","zone":17,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32218","projName":"utm","zone":18,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32219","projName":"utm","zone":19,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32220","projName":"utm","zone":20,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32221","projName":"utm","zone":21,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32222","projName":"utm","zone":22,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32223","projName":"utm","zone":23,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32224","projName":"utm","zone":24,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32225","projName":"utm","zone":25,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32226","projName":"utm","zone":26,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32227","projName":"utm","zone":27,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32228","projName":"utm","zone":28,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32229","projName":"utm","zone":29,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32230","projName":"utm","zone":30,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32231","projName":"utm","zone":31,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32232","projName":"utm","zone":32,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32233","projName":"utm","zone":33,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32234","projName":"utm","zone":34,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32235","projName":"utm","zone":35,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32236","projName":"utm","zone":36,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32237","projName":"utm","zone":37,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32238","projName":"utm","zone":38,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32239","projName":"utm","zone":39,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32240","projName":"utm","zone":40,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32241","projName":"utm","zone":41,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32242","projName":"utm","zone":42,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32243","projName":"utm","zone":43,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32244","projName":"utm","zone":44,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32245","projName":"utm","zone":45,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32246","projName":"utm","zone":46,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32247","projName":"utm","zone":47,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32248","projName":"utm","zone":48,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32249","projName":"utm","zone":49,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32250","projName":"utm","zone":50,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32251","projName":"utm","zone":51,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32252","projName":"utm","zone":52,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32253","projName":"utm","zone":53,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32254","projName":"utm","zone":54,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32255","projName":"utm","zone":55,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32256","projName":"utm","zone":56,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32257","projName":"utm","zone":57,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32258","projName":"utm","zone":58,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32259","projName":"utm","zone":59,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32260","projName":"utm","zone":60,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32301","projName":"utm","zone":1,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32302","projName":"utm","zone":2,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32303","projName":"utm","zone":3,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32304","projName":"utm","zone":4,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32305","projName":"utm","zone":5,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32306","projName":"utm","zone":6,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32307","projName":"utm","zone":7,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32308","projName":"utm","zone":8,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32309","projName":"utm","zone":9,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32310","projName":"utm","zone":10,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32311","projName":"utm","zone":11,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32312","projName":"utm","zone":12,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32313","projName":"utm","zone":13,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32314","projName":"utm","zone":14,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32315","projName":"utm","zone":15,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32316","projName":"utm","zone":16,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32317","projName":"utm","zone":17,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32318","projName":"utm","zone":18,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32319","projName":"utm","zone":19,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32320","projName":"utm","zone":20,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32321","projName":"utm","zone":21,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32322","projName":"utm","zone":22,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32323","projName":"utm","zone":23,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32324","projName":"utm","zone":24,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32325","projName":"utm","zone":25,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32326","projName":"utm","zone":26,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32327","projName":"utm","zone":27,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32328","projName":"utm","zone":28,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32329","projName":"utm","zone":29,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32330","projName":"utm","zone":30,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32331","projName":"utm","zone":31,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32332","projName":"utm","zone":32,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32333","projName":"utm","zone":33,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32334","projName":"utm","zone":34,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32335","projName":"utm","zone":35,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32336","projName":"utm","zone":36,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32337","projName":"utm","zone":37,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32338","projName":"utm","zone":38,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32339","projName":"utm","zone":39,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32340","projName":"utm","zone":40,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32341","projName":"utm","zone":41,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32342","projName":"utm","zone":42,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32343","projName":"utm","zone":43,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32344","projName":"utm","zone":44,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32345","projName":"utm","zone":45,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32346","projName":"utm","zone":46,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32347","projName":"utm","zone":47,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32348","projName":"utm","zone":48,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32349","projName":"utm","zone":49,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32350","projName":"utm","zone":50,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32351","projName":"utm","zone":51,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32352","projName":"utm","zone":52,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32353","projName":"utm","zone":53,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32354","projName":"utm","zone":54,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32355","projName":"utm","zone":55,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32356","projName":"utm","zone":56,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32357","projName":"utm","zone":57,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32358","projName":"utm","zone":58,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32359","projName":"utm","zone":59,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32360","projName":"utm","zone":60,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,4.5,0,0,0.554,0.2263],"units":"m","no_defs":true},{"EPSG":"32401","projName":"utm","zone":1,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32402","projName":"utm","zone":2,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32403","projName":"utm","zone":3,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32404","projName":"utm","zone":4,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32405","projName":"utm","zone":5,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32406","projName":"utm","zone":6,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32407","projName":"utm","zone":7,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32408","projName":"utm","zone":8,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32409","projName":"utm","zone":9,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32410","projName":"utm","zone":10,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32411","projName":"utm","zone":11,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32412","projName":"utm","zone":12,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32413","projName":"utm","zone":13,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32414","projName":"utm","zone":14,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32415","projName":"utm","zone":15,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32416","projName":"utm","zone":16,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32417","projName":"utm","zone":17,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32418","projName":"utm","zone":18,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32419","projName":"utm","zone":19,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32420","projName":"utm","zone":20,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32421","projName":"utm","zone":21,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32422","projName":"utm","zone":22,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32423","projName":"utm","zone":23,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32424","projName":"utm","zone":24,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32425","projName":"utm","zone":25,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32426","projName":"utm","zone":26,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32427","projName":"utm","zone":27,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32428","projName":"utm","zone":28,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32429","projName":"utm","zone":29,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32430","projName":"utm","zone":30,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32431","projName":"utm","zone":31,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32432","projName":"utm","zone":32,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32433","projName":"utm","zone":33,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32434","projName":"utm","zone":34,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32435","projName":"utm","zone":35,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32436","projName":"utm","zone":36,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32437","projName":"utm","zone":37,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32438","projName":"utm","zone":38,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32439","projName":"utm","zone":39,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32440","projName":"utm","zone":40,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32441","projName":"utm","zone":41,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32442","projName":"utm","zone":42,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32443","projName":"utm","zone":43,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32444","projName":"utm","zone":44,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32445","projName":"utm","zone":45,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32446","projName":"utm","zone":46,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32447","projName":"utm","zone":47,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32448","projName":"utm","zone":48,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32449","projName":"utm","zone":49,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32450","projName":"utm","zone":50,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32451","projName":"utm","zone":51,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32452","projName":"utm","zone":52,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32453","projName":"utm","zone":53,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32454","projName":"utm","zone":54,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32455","projName":"utm","zone":55,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32456","projName":"utm","zone":56,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32457","projName":"utm","zone":57,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32458","projName":"utm","zone":58,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32459","projName":"utm","zone":59,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32460","projName":"utm","zone":60,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32501","projName":"utm","zone":1,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32502","projName":"utm","zone":2,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32503","projName":"utm","zone":3,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32504","projName":"utm","zone":4,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32505","projName":"utm","zone":5,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32506","projName":"utm","zone":6,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32507","projName":"utm","zone":7,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32508","projName":"utm","zone":8,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32509","projName":"utm","zone":9,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32510","projName":"utm","zone":10,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32511","projName":"utm","zone":11,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32512","projName":"utm","zone":12,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32513","projName":"utm","zone":13,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32514","projName":"utm","zone":14,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32515","projName":"utm","zone":15,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32516","projName":"utm","zone":16,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32517","projName":"utm","zone":17,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32518","projName":"utm","zone":18,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32519","projName":"utm","zone":19,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32520","projName":"utm","zone":20,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32521","projName":"utm","zone":21,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32522","projName":"utm","zone":22,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32523","projName":"utm","zone":23,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32524","projName":"utm","zone":24,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32525","projName":"utm","zone":25,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32526","projName":"utm","zone":26,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32527","projName":"utm","zone":27,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32528","projName":"utm","zone":28,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32529","projName":"utm","zone":29,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32530","projName":"utm","zone":30,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32531","projName":"utm","zone":31,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32532","projName":"utm","zone":32,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32533","projName":"utm","zone":33,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32534","projName":"utm","zone":34,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32535","projName":"utm","zone":35,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32536","projName":"utm","zone":36,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32537","projName":"utm","zone":37,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32538","projName":"utm","zone":38,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32539","projName":"utm","zone":39,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32540","projName":"utm","zone":40,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32541","projName":"utm","zone":41,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32542","projName":"utm","zone":42,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32543","projName":"utm","zone":43,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32544","projName":"utm","zone":44,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32545","projName":"utm","zone":45,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32546","projName":"utm","zone":46,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32547","projName":"utm","zone":47,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32548","projName":"utm","zone":48,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32549","projName":"utm","zone":49,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32550","projName":"utm","zone":50,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32551","projName":"utm","zone":51,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32552","projName":"utm","zone":52,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32553","projName":"utm","zone":53,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32554","projName":"utm","zone":54,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32555","projName":"utm","zone":55,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32556","projName":"utm","zone":56,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32557","projName":"utm","zone":57,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32558","projName":"utm","zone":58,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32559","projName":"utm","zone":59,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32560","projName":"utm","zone":60,"utmSouth":true,"ellps":"WGS72","datum_params":[0,0,1.9,0,0,0.814,-0.38],"units":"m","no_defs":true},{"EPSG":"32601","projName":"utm","zone":1,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32602","projName":"utm","zone":2,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32603","projName":"utm","zone":3,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32604","projName":"utm","zone":4,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32605","projName":"utm","zone":5,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32606","projName":"utm","zone":6,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32607","projName":"utm","zone":7,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32608","projName":"utm","zone":8,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32609","projName":"utm","zone":9,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32610","projName":"utm","zone":10,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32611","projName":"utm","zone":11,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32612","projName":"utm","zone":12,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32613","projName":"utm","zone":13,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32614","projName":"utm","zone":14,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32615","projName":"utm","zone":15,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32616","projName":"utm","zone":16,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32617","projName":"utm","zone":17,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32618","projName":"utm","zone":18,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32619","projName":"utm","zone":19,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32620","projName":"utm","zone":20,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32621","projName":"utm","zone":21,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32622","projName":"utm","zone":22,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32623","projName":"utm","zone":23,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32624","projName":"utm","zone":24,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32625","projName":"utm","zone":25,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32626","projName":"utm","zone":26,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32627","projName":"utm","zone":27,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32628","projName":"utm","zone":28,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32629","projName":"utm","zone":29,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32630","projName":"utm","zone":30,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32631","projName":"utm","zone":31,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32632","projName":"utm","zone":32,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32633","projName":"utm","zone":33,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32634","projName":"utm","zone":34,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32635","projName":"utm","zone":35,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32636","projName":"utm","zone":36,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32637","projName":"utm","zone":37,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32638","projName":"utm","zone":38,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32639","projName":"utm","zone":39,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32640","projName":"utm","zone":40,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32641","projName":"utm","zone":41,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32642","projName":"utm","zone":42,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32643","projName":"utm","zone":43,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32644","projName":"utm","zone":44,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32645","projName":"utm","zone":45,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32646","projName":"utm","zone":46,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32647","projName":"utm","zone":47,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32648","projName":"utm","zone":48,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32649","projName":"utm","zone":49,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32650","projName":"utm","zone":50,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32651","projName":"utm","zone":51,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32652","projName":"utm","zone":52,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32653","projName":"utm","zone":53,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32654","projName":"utm","zone":54,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32655","projName":"utm","zone":55,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32656","projName":"utm","zone":56,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32657","projName":"utm","zone":57,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32658","projName":"utm","zone":58,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32659","projName":"utm","zone":59,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32660","projName":"utm","zone":60,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32661","projName":"stere","lat0":1.5707963267948966,"lat_ts":1.5707963267948966,"long0":0,"k0":0.994,"x0":2000000,"y0":2000000,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32662","projName":"eqc","lat_ts":0,"lat0":0,"long0":0,"x0":0,"y0":0,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32664","projName":"tmerc","lat0":0,"long0":-1.7278759594743862,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"WGS84","units":"us-ft","no_defs":true},{"EPSG":"32665","projName":"tmerc","lat0":0,"long0":-1.6231562043547265,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"WGS84","units":"us-ft","no_defs":true},{"EPSG":"32666","projName":"tmerc","lat0":0,"long0":-1.5184364492350666,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"WGS84","units":"us-ft","no_defs":true},{"EPSG":"32667","projName":"tmerc","lat0":0,"long0":-1.413716694115407,"k0":0.9996,"x0":500000.001016002,"y0":0,"datumCode":"WGS84","units":"us-ft","no_defs":true},{"EPSG":"32701","projName":"utm","zone":1,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32702","projName":"utm","zone":2,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32703","projName":"utm","zone":3,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32704","projName":"utm","zone":4,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32705","projName":"utm","zone":5,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32706","projName":"utm","zone":6,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32707","projName":"utm","zone":7,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32708","projName":"utm","zone":8,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32709","projName":"utm","zone":9,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32710","projName":"utm","zone":10,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32711","projName":"utm","zone":11,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32712","projName":"utm","zone":12,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32713","projName":"utm","zone":13,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32714","projName":"utm","zone":14,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32715","projName":"utm","zone":15,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32716","projName":"utm","zone":16,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32717","projName":"utm","zone":17,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32718","projName":"utm","zone":18,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32719","projName":"utm","zone":19,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32720","projName":"utm","zone":20,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32721","projName":"utm","zone":21,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32722","projName":"utm","zone":22,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32723","projName":"utm","zone":23,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32724","projName":"utm","zone":24,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32725","projName":"utm","zone":25,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32726","projName":"utm","zone":26,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32727","projName":"utm","zone":27,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32728","projName":"utm","zone":28,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32729","projName":"utm","zone":29,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32730","projName":"utm","zone":30,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32731","projName":"utm","zone":31,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32732","projName":"utm","zone":32,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32733","projName":"utm","zone":33,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32734","projName":"utm","zone":34,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32735","projName":"utm","zone":35,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32736","projName":"utm","zone":36,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32737","projName":"utm","zone":37,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32738","projName":"utm","zone":38,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32739","projName":"utm","zone":39,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32740","projName":"utm","zone":40,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32741","projName":"utm","zone":41,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32742","projName":"utm","zone":42,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32743","projName":"utm","zone":43,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32744","projName":"utm","zone":44,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32745","projName":"utm","zone":45,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32746","projName":"utm","zone":46,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32747","projName":"utm","zone":47,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32748","projName":"utm","zone":48,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32749","projName":"utm","zone":49,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32750","projName":"utm","zone":50,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32751","projName":"utm","zone":51,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32752","projName":"utm","zone":52,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32753","projName":"utm","zone":53,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32754","projName":"utm","zone":54,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32755","projName":"utm","zone":55,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32756","projName":"utm","zone":56,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32757","projName":"utm","zone":57,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32758","projName":"utm","zone":58,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32759","projName":"utm","zone":59,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32760","projName":"utm","zone":60,"utmSouth":true,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32761","projName":"stere","lat0":-1.5707963267948966,"lat_ts":-1.5707963267948966,"long0":0,"k0":0.994,"x0":2000000,"y0":2000000,"datumCode":"WGS84","units":"m","no_defs":true},{"EPSG":"32766","projName":"tmerc","lat0":0,"long0":0.6283185307179586,"k0":0.9996,"x0":500000,"y0":10000000,"datumCode":"WGS84","units":"m","no_defs":true}]);
//data from http://svn.osgeo.org/metacrs/proj/trunk/proj/nad/esri
proj4.defs('WGS84', "+title=WGS 84 (long/lat) +proj=longlat +ellps=WGS84 +datum=WGS84 +units=degrees");
proj4.defs('EPSG:4326', "+title=WGS 84 (long/lat) +proj=longlat +ellps=WGS84 +datum=WGS84 +units=degrees");
proj4.defs('EPSG:4269', "+title=NAD83 (long/lat) +proj=longlat +a=6378137.0 +b=6356752.31414036 +ellps=GRS80 +datum=NAD83 +units=degrees");
proj4.defs('EPSG:3857', "+title=WGS 84 / Pseudo-Mercator +proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +no_defs");

proj4.defs['EPSG:3785'] = proj4.defs['EPSG:3857'];  // maintain backward compat, official code is 3857
proj4.defs.GOOGLE = proj4.defs['EPSG:3857'];
proj4.defs['EPSG:900913'] = proj4.defs['EPSG:3857'];
proj4.defs['EPSG:102113'] = proj4.defs['EPSG:3857'];
/** datum object
 */
proj4.datum = proj4.Class({

  initialize: function(proj) {
    this.datum_type = proj4.common.PJD_WGS84; //default setting
    if (!proj) {
      return;
    }
    if (proj.datumCode && proj.datumCode === 'none') {
      this.datum_type = proj4.common.PJD_NODATUM;
    }
    if (proj.datum_params) {
      for (var i = 0; i < proj.datum_params.length; i++) {
        proj.datum_params[i] = parseFloat(proj.datum_params[i]);
      }
      if (proj.datum_params[0] !== 0 || proj.datum_params[1] !== 0 || proj.datum_params[2] !== 0) {
        this.datum_type = proj4.common.PJD_3PARAM;
      }
      if (proj.datum_params.length > 3) {
        if (proj.datum_params[3] !== 0 || proj.datum_params[4] !== 0 || proj.datum_params[5] !== 0 || proj.datum_params[6] !== 0) {
          this.datum_type = proj4.common.PJD_7PARAM;
          proj.datum_params[3] *= proj4.common.SEC_TO_RAD;
          proj.datum_params[4] *= proj4.common.SEC_TO_RAD;
          proj.datum_params[5] *= proj4.common.SEC_TO_RAD;
          proj.datum_params[6] = (proj.datum_params[6] / 1000000.0) + 1.0;
        }
      }
    }
    // DGR 2011-03-21 : nadgrids support
    this.datum_type = proj.grids ? proj4.common.PJD_GRIDSHIFT : this.datum_type;

    this.a = proj.a; //datum object also uses these values
    this.b = proj.b;
    this.es = proj.es;
    this.ep2 = proj.ep2;
    this.datum_params = proj.datum_params;
    if (this.datum_type === proj4.common.PJD_GRIDSHIFT) {
      this.grids = proj.grids;
    }
  },

  /****************************************************************/
  // cs_compare_datums()
  //   Returns TRUE if the two datums match, otherwise FALSE.
  compare_datums: function(dest) {
    if (this.datum_type !== dest.datum_type) {
      return false; // false, datums are not equal
    }
    else if (this.a !== dest.a || Math.abs(this.es - dest.es) > 0.000000000050) {
      // the tolerence for es is to ensure that GRS80 and WGS84
      // are considered identical
      return false;
    }
    else if (this.datum_type === proj4.common.PJD_3PARAM) {
      return (this.datum_params[0] === dest.datum_params[0] && this.datum_params[1] === dest.datum_params[1] && this.datum_params[2] === dest.datum_params[2]);
    }
    else if (this.datum_type === proj4.common.PJD_7PARAM) {
      return (this.datum_params[0] === dest.datum_params[0] && this.datum_params[1] === dest.datum_params[1] && this.datum_params[2] === dest.datum_params[2] && this.datum_params[3] === dest.datum_params[3] && this.datum_params[4] === dest.datum_params[4] && this.datum_params[5] === dest.datum_params[5] && this.datum_params[6] === dest.datum_params[6]);
    }
    else if (this.datum_type === proj4.common.PJD_GRIDSHIFT || dest.datum_type === proj4.common.PJD_GRIDSHIFT) {
      //alert("ERROR: Grid shift transformations are not implemented.");
      //return false
      //DGR 2012-07-29 lazy ...
      return this.nadgrids === dest.nadgrids;
    }
    else {
      return true; // datums are equal
    }
  }, // cs_compare_datums()

  /*
   * The function Convert_Geodetic_To_Geocentric converts geodetic coordinates
   * (latitude, longitude, and height) to geocentric coordinates (X, Y, Z),
   * according to the current ellipsoid parameters.
   *
   *    Latitude  : Geodetic latitude in radians                     (input)
   *    Longitude : Geodetic longitude in radians                    (input)
   *    Height    : Geodetic height, in meters                       (input)
   *    X         : Calculated Geocentric X coordinate, in meters    (output)
   *    Y         : Calculated Geocentric Y coordinate, in meters    (output)
   *    Z         : Calculated Geocentric Z coordinate, in meters    (output)
   *
   */
  geodetic_to_geocentric: function(p) {
    var Longitude = p.x;
    var Latitude = p.y;
    var Height = p.z ? p.z : 0; //Z value not always supplied
    var X; // output
    var Y;
    var Z;

    var Error_Code = 0; //  GEOCENT_NO_ERROR;
    var Rn; /*  Earth radius at location  */
    var Sin_Lat; /*  Math.sin(Latitude)  */
    var Sin2_Lat; /*  Square of Math.sin(Latitude)  */
    var Cos_Lat; /*  Math.cos(Latitude)  */

    /*
     ** Don't blow up if Latitude is just a little out of the value
     ** range as it may just be a rounding issue.  Also removed longitude
     ** test, it should be wrapped by Math.cos() and Math.sin().  NFW for PROJ.4, Sep/2001.
     */
    if (Latitude < -proj4.common.HALF_PI && Latitude > -1.001 * proj4.common.HALF_PI) {
      Latitude = -proj4.common.HALF_PI;
    }
    else if (Latitude > proj4.common.HALF_PI && Latitude < 1.001 * proj4.common.HALF_PI) {
      Latitude = proj4.common.HALF_PI;
    }
    else if ((Latitude < -proj4.common.HALF_PI) || (Latitude > proj4.common.HALF_PI)) {
      /* Latitude out of range */
      proj4.reportError('geocent:lat out of range:' + Latitude);
      return null;
    }

    if (Longitude > proj4.common.PI){
      Longitude -= (2 * proj4.common.PI);
    }
    Sin_Lat = Math.sin(Latitude);
    Cos_Lat = Math.cos(Latitude);
    Sin2_Lat = Sin_Lat * Sin_Lat;
    Rn = this.a / (Math.sqrt(1.0e0 - this.es * Sin2_Lat));
    X = (Rn + Height) * Cos_Lat * Math.cos(Longitude);
    Y = (Rn + Height) * Cos_Lat * Math.sin(Longitude);
    Z = ((Rn * (1 - this.es)) + Height) * Sin_Lat;

    p.x = X;
    p.y = Y;
    p.z = Z;
    return Error_Code;
  }, // cs_geodetic_to_geocentric()


  geocentric_to_geodetic: function(p) {
    /* local defintions and variables */
    /* end-criterium of loop, accuracy of sin(Latitude) */
    var genau = 1e-12;
    var genau2 = (genau * genau);
    var maxiter = 30;

    var P; /* distance between semi-minor axis and location */
    var RR; /* distance between center and location */
    var CT; /* sin of geocentric latitude */
    var ST; /* cos of geocentric latitude */
    var RX;
    var RK;
    var RN; /* Earth radius at location */
    var CPHI0; /* cos of start or old geodetic latitude in iterations */
    var SPHI0; /* sin of start or old geodetic latitude in iterations */
    var CPHI; /* cos of searched geodetic latitude */
    var SPHI; /* sin of searched geodetic latitude */
    var SDPHI; /* end-criterium: addition-theorem of sin(Latitude(iter)-Latitude(iter-1)) */
    var At_Pole; /* indicates location is in polar region */
    var iter; /* # of continous iteration, max. 30 is always enough (s.a.) */

    var X = p.x;
    var Y = p.y;
    var Z = p.z ? p.z : 0.0; //Z value not always supplied
    var Longitude;
    var Latitude;
    var Height;

    At_Pole = false;
    P = Math.sqrt(X * X + Y * Y);
    RR = Math.sqrt(X * X + Y * Y + Z * Z);

    /*      special cases for latitude and longitude */
    if (P / this.a < genau) {

      /*  special case, if P=0. (X=0., Y=0.) */
      At_Pole = true;
      Longitude = 0.0;

      /*  if (X,Y,Z)=(0.,0.,0.) then Height becomes semi-minor axis
       *  of ellipsoid (=center of mass), Latitude becomes PI/2 */
      if (RR / this.a < genau) {
        Latitude = proj4.common.HALF_PI;
        Height = -this.b;
        return;
      }
    }
    else {
      /*  ellipsoidal (geodetic) longitude
       *  interval: -PI < Longitude <= +PI */
      Longitude = Math.atan2(Y, X);
    }

    /* --------------------------------------------------------------
     * Following iterative algorithm was developped by
     * "Institut for Erdmessung", University of Hannover, July 1988.
     * Internet: www.ife.uni-hannover.de
     * Iterative computation of CPHI,SPHI and Height.
     * Iteration of CPHI and SPHI to 10**-12 radian resp.
     * 2*10**-7 arcsec.
     * --------------------------------------------------------------
     */
    CT = Z / RR;
    ST = P / RR;
    RX = 1.0 / Math.sqrt(1.0 - this.es * (2.0 - this.es) * ST * ST);
    CPHI0 = ST * (1.0 - this.es) * RX;
    SPHI0 = CT * RX;
    iter = 0;

    /* loop to find sin(Latitude) resp. Latitude
     * until |sin(Latitude(iter)-Latitude(iter-1))| < genau */
    do {
      iter++;
      RN = this.a / Math.sqrt(1.0 - this.es * SPHI0 * SPHI0);

      /*  ellipsoidal (geodetic) height */
      Height = P * CPHI0 + Z * SPHI0 - RN * (1.0 - this.es * SPHI0 * SPHI0);

      RK = this.es * RN / (RN + Height);
      RX = 1.0 / Math.sqrt(1.0 - RK * (2.0 - RK) * ST * ST);
      CPHI = ST * (1.0 - RK) * RX;
      SPHI = CT * RX;
      SDPHI = SPHI * CPHI0 - CPHI * SPHI0;
      CPHI0 = CPHI;
      SPHI0 = SPHI;
    }
    while (SDPHI * SDPHI > genau2 && iter < maxiter);

    /*      ellipsoidal (geodetic) latitude */
    Latitude = Math.atan(SPHI / Math.abs(CPHI));

    p.x = Longitude;
    p.y = Latitude;
    p.z = Height;
    return p;
  }, // cs_geocentric_to_geodetic()

  /** Convert_Geocentric_To_Geodetic
   * The method used here is derived from 'An Improved Algorithm for
   * Geocentric to Geodetic Coordinate Conversion', by Ralph Toms, Feb 1996
   */
  geocentric_to_geodetic_noniter: function(p) {
    var X = p.x;
    var Y = p.y;
    var Z = p.z ? p.z : 0; //Z value not always supplied
    var Longitude;
    var Latitude;
    var Height;

    var W; /* distance from Z axis */
    var W2; /* square of distance from Z axis */
    var T0; /* initial estimate of vertical component */
    var T1; /* corrected estimate of vertical component */
    var S0; /* initial estimate of horizontal component */
    var S1; /* corrected estimate of horizontal component */
    var Sin_B0; /* Math.sin(B0), B0 is estimate of Bowring aux variable */
    var Sin3_B0; /* cube of Math.sin(B0) */
    var Cos_B0; /* Math.cos(B0) */
    var Sin_p1; /* Math.sin(phi1), phi1 is estimated latitude */
    var Cos_p1; /* Math.cos(phi1) */
    var Rn; /* Earth radius at location */
    var Sum; /* numerator of Math.cos(phi1) */
    var At_Pole; /* indicates location is in polar region */

    X = parseFloat(X); // cast from string to float
    Y = parseFloat(Y);
    Z = parseFloat(Z);

    At_Pole = false;
    if (X !== 0.0) {
      Longitude = Math.atan2(Y, X);
    }
    else {
      if (Y > 0) {
        Longitude = proj4.common.HALF_PI;
      }
      else if (Y < 0) {
        Longitude = -proj4.common.HALF_PI;
      }
      else {
        At_Pole = true;
        Longitude = 0.0;
        if (Z > 0.0) { /* north pole */
          Latitude = proj4.common.HALF_PI;
        }
        else if (Z < 0.0) { /* south pole */
          Latitude = -proj4.common.HALF_PI;
        }
        else { /* center of earth */
          Latitude = proj4.common.HALF_PI;
          Height = -this.b;
          return;
        }
      }
    }
    W2 = X * X + Y * Y;
    W = Math.sqrt(W2);
    T0 = Z * proj4.common.AD_C;
    S0 = Math.sqrt(T0 * T0 + W2);
    Sin_B0 = T0 / S0;
    Cos_B0 = W / S0;
    Sin3_B0 = Sin_B0 * Sin_B0 * Sin_B0;
    T1 = Z + this.b * this.ep2 * Sin3_B0;
    Sum = W - this.a * this.es * Cos_B0 * Cos_B0 * Cos_B0;
    S1 = Math.sqrt(T1 * T1 + Sum * Sum);
    Sin_p1 = T1 / S1;
    Cos_p1 = Sum / S1;
    Rn = this.a / Math.sqrt(1.0 - this.es * Sin_p1 * Sin_p1);
    if (Cos_p1 >= proj4.common.COS_67P5) {
      Height = W / Cos_p1 - Rn;
    }
    else if (Cos_p1 <= -proj4.common.COS_67P5) {
      Height = W / -Cos_p1 - Rn;
    }
    else {
      Height = Z / Sin_p1 + Rn * (this.es - 1.0);
    }
    if (At_Pole === false) {
      Latitude = Math.atan(Sin_p1 / Cos_p1);
    }

    p.x = Longitude;
    p.y = Latitude;
    p.z = Height;
    return p;
  }, // geocentric_to_geodetic_noniter()

  /****************************************************************/
  // pj_geocentic_to_wgs84( p )
  //  p = point to transform in geocentric coordinates (x,y,z)
  geocentric_to_wgs84: function(p) {

    if (this.datum_type === proj4.common.PJD_3PARAM) {
      // if( x[io] === HUGE_VAL )
      //    continue;
      p.x += this.datum_params[0];
      p.y += this.datum_params[1];
      p.z += this.datum_params[2];

    }
    else if (this.datum_type === proj4.common.PJD_7PARAM) {
      var Dx_BF = this.datum_params[0];
      var Dy_BF = this.datum_params[1];
      var Dz_BF = this.datum_params[2];
      var Rx_BF = this.datum_params[3];
      var Ry_BF = this.datum_params[4];
      var Rz_BF = this.datum_params[5];
      var M_BF = this.datum_params[6];
      // if( x[io] === HUGE_VAL )
      //    continue;
      var x_out = M_BF * (p.x - Rz_BF * p.y + Ry_BF * p.z) + Dx_BF;
      var y_out = M_BF * (Rz_BF * p.x + p.y - Rx_BF * p.z) + Dy_BF;
      var z_out = M_BF * (-Ry_BF * p.x + Rx_BF * p.y + p.z) + Dz_BF;
      p.x = x_out;
      p.y = y_out;
      p.z = z_out;
    }
  }, // cs_geocentric_to_wgs84

  /****************************************************************/
  // pj_geocentic_from_wgs84()
  //  coordinate system definition,
  //  point to transform in geocentric coordinates (x,y,z)
  geocentric_from_wgs84: function(p) {

    if (this.datum_type === proj4.common.PJD_3PARAM) {
      //if( x[io] === HUGE_VAL )
      //    continue;
      p.x -= this.datum_params[0];
      p.y -= this.datum_params[1];
      p.z -= this.datum_params[2];

    }
    else if (this.datum_type === proj4.common.PJD_7PARAM) {
      var Dx_BF = this.datum_params[0];
      var Dy_BF = this.datum_params[1];
      var Dz_BF = this.datum_params[2];
      var Rx_BF = this.datum_params[3];
      var Ry_BF = this.datum_params[4];
      var Rz_BF = this.datum_params[5];
      var M_BF = this.datum_params[6];
      var x_tmp = (p.x - Dx_BF) / M_BF;
      var y_tmp = (p.y - Dy_BF) / M_BF;
      var z_tmp = (p.z - Dz_BF) / M_BF;
      //if( x[io] === HUGE_VAL )
      //    continue;

      p.x = x_tmp + Rz_BF * y_tmp - Ry_BF * z_tmp;
      p.y = -Rz_BF * x_tmp + y_tmp + Rx_BF * z_tmp;
      p.z = Ry_BF * x_tmp - Rx_BF * y_tmp + z_tmp;
    } //cs_geocentric_from_wgs84()
  }
});

/** point object, nothing fancy, just allows values to be
    passed back and forth by reference rather than by value.
    Other point classes may be used as long as they have
    x and y properties, which will get modified in the transform method.
*/

proj4.Point = proj4.Class({

  /**
   * Constructor: proj4.Point
   *
   * Parameters:
   * - x {float} or {Array} either the first coordinates component or
   *     the full coordinates
   * - y {float} the second component
   * - z {float} the third component, optional.
   */
  initialize : function(x,y,z) {
    if (typeof x === 'object') {
      this.x = x[0];
      this.y = x[1];
      this.z = x[2] || 0.0;
    } else if (typeof x === 'string' && typeof y === 'undefined') {
      var coords = x.split(',');
      this.x = parseFloat(coords[0]);
      this.y = parseFloat(coords[1]);
      this.z = parseFloat(coords[2]) || 0.0;
    } else {
      this.x = x;
      this.y = y;
      this.z = z || 0.0;
    }
  },
  /**
   * APIMethod: clone
   * Build a copy of a proj4.Point object.
   *
   * Return:
   * {proj4}.Point the cloned point.
   */
  clone : function() {
    return new proj4.Point(this.x, this.y, this.z);
  },
    /**
   * APIMethod: toString
   * Return a readable string version of the point
   *
   * Return:
   * {String} String representation of proj4.Point object. 
   *           (ex. <i>"x=5,y=42"</i>)
   */
  toString : function() {
    return ("x=" + this.x + ",y=" + this.y);
  },
  /** 
   * APIMethod: toShortString
   * Return a short string version of the point.
   *
   * Return:
   * {String} Shortened String representation of proj4.Point object. 
   *         (ex. <i>"5, 42"</i>)
   */
  toShortString : function() {
    return (this.x + ", " + this.y);
  }
});

proj4.PrimeMeridian = {
  "greenwich": 0.0, //"0dE",
  "lisbon": -9.131906111111, //"9d07'54.862\"W",
  "paris": 2.337229166667, //"2d20'14.025\"E",
  "bogota": -74.080916666667, //"74d04'51.3\"W",
  "madrid": -3.687938888889, //"3d41'16.58\"W",
  "rome": 12.452333333333, //"12d27'8.4\"E",
  "bern": 7.439583333333, //"7d26'22.5\"E",
  "jakarta": 106.807719444444, //"106d48'27.79\"E",
  "ferro": -17.666666666667, //"17d40'W",
  "brussels": 4.367975, //"4d22'4.71\"E",
  "stockholm": 18.058277777778, //"18d3'29.8\"E",
  "athens": 23.7163375, //"23d42'58.815\"E",
  "oslo": 10.722916666667 //"10d43'22.5\"E"
};

proj4.Ellipsoid = {
  "MERIT": {
    a: 6378137.0,
    rf: 298.257,
    ellipseName: "MERIT 1983"
  },
  "SGS85": {
    a: 6378136.0,
    rf: 298.257,
    ellipseName: "Soviet Geodetic System 85"
  },
  "GRS80": {
    a: 6378137.0,
    rf: 298.257222101,
    ellipseName: "GRS 1980(IUGG, 1980)"
  },
  "IAU76": {
    a: 6378140.0,
    rf: 298.257,
    ellipseName: "IAU 1976"
  },
  "airy": {
    a: 6377563.396,
    b: 6356256.910,
    ellipseName: "Airy 1830"
  },
  "APL4.": {
    a: 6378137,
    rf: 298.25,
    ellipseName: "Appl. Physics. 1965"
  },
  "NWL9D": {
    a: 6378145.0,
    rf: 298.25,
    ellipseName: "Naval Weapons Lab., 1965"
  },
  "mod_airy": {
    a: 6377340.189,
    b: 6356034.446,
    ellipseName: "Modified Airy"
  },
  "andrae": {
    a: 6377104.43,
    rf: 300.0,
    ellipseName: "Andrae 1876 (Den., Iclnd.)"
  },
  "aust_SA": {
    a: 6378160.0,
    rf: 298.25,
    ellipseName: "Australian Natl & S. Amer. 1969"
  },
  "GRS67": {
    a: 6378160.0,
    rf: 298.2471674270,
    ellipseName: "GRS 67(IUGG 1967)"
  },
  "bessel": {
    a: 6377397.155,
    rf: 299.1528128,
    ellipseName: "Bessel 1841"
  },
  "bess_nam": {
    a: 6377483.865,
    rf: 299.1528128,
    ellipseName: "Bessel 1841 (Namibia)"
  },
  "clrk66": {
    a: 6378206.4,
    b: 6356583.8,
    ellipseName: "Clarke 1866"
  },
  "clrk80": {
    a: 6378249.145,
    rf: 293.4663,
    ellipseName: "Clarke 1880 mod."
  },
  "CPM": {
    a: 6375738.7,
    rf: 334.29,
    ellipseName: "Comm. des Poids et Mesures 1799"
  },
  "delmbr": {
    a: 6376428.0,
    rf: 311.5,
    ellipseName: "Delambre 1810 (Belgium)"
  },
  "engelis": {
    a: 6378136.05,
    rf: 298.2566,
    ellipseName: "Engelis 1985"
  },
  "evrst30": {
    a: 6377276.345,
    rf: 300.8017,
    ellipseName: "Everest 1830"
  },
  "evrst48": {
    a: 6377304.063,
    rf: 300.8017,
    ellipseName: "Everest 1948"
  },
  "evrst56": {
    a: 6377301.243,
    rf: 300.8017,
    ellipseName: "Everest 1956"
  },
  "evrst69": {
    a: 6377295.664,
    rf: 300.8017,
    ellipseName: "Everest 1969"
  },
  "evrstSS": {
    a: 6377298.556,
    rf: 300.8017,
    ellipseName: "Everest (Sabah & Sarawak)"
  },
  "fschr60": {
    a: 6378166.0,
    rf: 298.3,
    ellipseName: "Fischer (Mercury Datum) 1960"
  },
  "fschr60m": {
    a: 6378155.0,
    rf: 298.3,
    ellipseName: "Fischer 1960"
  },
  "fschr68": {
    a: 6378150.0,
    rf: 298.3,
    ellipseName: "Fischer 1968"
  },
  "helmert": {
    a: 6378200.0,
    rf: 298.3,
    ellipseName: "Helmert 1906"
  },
  "hough": {
    a: 6378270.0,
    rf: 297.0,
    ellipseName: "Hough"
  },
  "intl": {
    a: 6378388.0,
    rf: 297.0,
    ellipseName: "International 1909 (Hayford)"
  },
  "kaula": {
    a: 6378163.0,
    rf: 298.24,
    ellipseName: "Kaula 1961"
  },
  "lerch": {
    a: 6378139.0,
    rf: 298.257,
    ellipseName: "Lerch 1979"
  },
  "mprts": {
    a: 6397300.0,
    rf: 191.0,
    ellipseName: "Maupertius 1738"
  },
  "new_intl": {
    a: 6378157.5,
    b: 6356772.2,
    ellipseName: "New International 1967"
  },
  "plessis": {
    a: 6376523.0,
    rf: 6355863.0,
    ellipseName: "Plessis 1817 (France)"
  },
  "krass": {
    a: 6378245.0,
    rf: 298.3,
    ellipseName: "Krassovsky, 1942"
  },
  "SEasia": {
    a: 6378155.0,
    b: 6356773.3205,
    ellipseName: "Southeast Asia"
  },
  "walbeck": {
    a: 6376896.0,
    b: 6355834.8467,
    ellipseName: "Walbeck"
  },
  "WGS60": {
    a: 6378165.0,
    rf: 298.3,
    ellipseName: "WGS 60"
  },
  "WGS66": {
    a: 6378145.0,
    rf: 298.25,
    ellipseName: "WGS 66"
  },
  "WGS72": {
    a: 6378135.0,
    rf: 298.26,
    ellipseName: "WGS 72"
  },
  "WGS84": {
    a: 6378137.0,
    rf: 298.257223563,
    ellipseName: "WGS 84"
  },
  "sphere": {
    a: 6370997.0,
    b: 6370997.0,
    ellipseName: "Normal Sphere (r=6370997)"
  }
};

proj4.Datum = {
  "WGS84": {
    towgs84: "0,0,0",
    ellipse: "WGS84",
    datumName: "WGS84"
  },
  "GGRS87": {
    towgs84: "-199.87,74.79,246.62",
    ellipse: "GRS80",
    datumName: "Greek_Geodetic_Reference_System_1987"
  },
  "NAD83": {
    towgs84: "0,0,0",
    ellipse: "GRS80",
    datumName: "North_American_Datum_1983"
  },
  "NAD27": {
    nadgrids: "@conus,@alaska,@ntv2_0.gsb,@ntv1_can.dat",
    ellipse: "clrk66",
    datumName: "North_American_Datum_1927"
  },
  "potsdam": {
    towgs84: "606.0,23.0,413.0",
    ellipse: "bessel",
    datumName: "Potsdam Rauenberg 1950 DHDN"
  },
  "carthage": {
    towgs84: "-263.0,6.0,431.0",
    ellipse: "clark80",
    datumName: "Carthage 1934 Tunisia"
  },
  "hermannskogel": {
    towgs84: "653.0,-212.0,449.0",
    ellipse: "bessel",
    datumName: "Hermannskogel"
  },
  "ire65": {
    towgs84: "482.530,-130.596,564.557,-1.042,-0.214,-0.631,8.15",
    ellipse: "mod_airy",
    datumName: "Ireland 1965"
  },
  "nzgd49": {
    towgs84: "59.47,-5.04,187.44,0.47,-0.1,1.024,-4.5993",
    ellipse: "intl",
    datumName: "New Zealand Geodetic Datum 1949"
  },
  "OSGB36": {
    towgs84: "446.448,-125.157,542.060,0.1502,0.2470,0.8421,-20.4894",
    ellipse: "airy",
    datumName: "Airy 1830"
  }
};

proj4.WGS84 = new proj4.Proj('WGS84');
proj4.Datum.OSB36 = proj4.Datum.OSGB36; //as returned from spatialreference.org

//lookup table to go from the projection name in WKT to the proj4 projection name
//build this out as required
proj4.wktProjections = {
  "Lambert Tangential Conformal Conic Projection": "lcc",
  "Lambert_Conformal_Conic": "lcc",
  "Mercator": "merc",
  "Popular Visualisation Pseudo Mercator": "merc",
  "Mercator_1SP": "merc",
  "Transverse_Mercator": "tmerc",
  "Transverse Mercator": "tmerc",
  "Lambert Azimuthal Equal Area": "laea",
  "Universal Transverse Mercator System": "utm"
};

// Based on proj4 CTABLE  structure :
// FIXME: better to have array instead of object holding longitudes, latitudes members
//        In the former case, one has to document index 0 is longitude and
//        1 is latitude ...
//        In the later case, grid object gets bigger !!!!
//        Solution 1 is chosen based on pj_gridinfo.c
proj4.grids = {
  "null": { // name of grid's file
    "ll": [-3.14159265, - 1.57079633], // lower-left coordinates in radians (longitude, latitude):
    "del": [3.14159265, 1.57079633], // cell's size in radians (longitude, latitude):
    "lim": [3, 3], // number of nodes in longitude, latitude (including edges):
    "count": 9, // total number of nodes
    "cvs": [ // shifts : in ntv2 reverse order : lon, lat in radians ...
      [0.0, 0.0],
      [0.0, 0.0],
      [0.0, 0.0], // for (lon= 0; lon<lim[0]; lon++) {
      [0.0, 0.0],
      [0.0, 0.0],
      [0.0, 0.0], //   for (lat= 0; lat<lim[1]; lat++) { p= cvs[lat*lim[0]+lon]; }
      [0.0, 0.0],
      [0.0, 0.0],
      [0.0, 0.0] // }
    ]
  }
};

/*******************************************************************************
NAME                     ALBERS CONICAL EQUAL AREA 

PURPOSE:  Transforms input longitude and latitude to Easting and Northing
    for the Albers Conical Equal Area projection.  The longitude
    and latitude must be in radians.  The Easting and Northing
    values will be returned in meters.

PROGRAMMER              DATE
----------              ----
T. Mittan,         Feb, 1992

ALGORITHM REFERENCES

1.  Snyder, John P., "Map Projections--A Working Manual", U.S. Geological
    Survey Professional Paper 1395 (Supersedes USGS Bulletin 1532), United
    State Government Printing Office, Washington D.C., 1987.

2.  Snyder, John P. and Voxland, Philip M., "An Album of Map Projections",
    U.S. Geological Survey Professional Paper 1453 , United State Government
    Printing Office, Washington D.C., 1989.
*******************************************************************************/


proj4.Proj.aea = {
  init: function() {

    if (Math.abs(this.lat1 + this.lat2) < proj4.common.EPSLN) {
      proj4.reportError("aeaInitEqualLatitudes");
      return;
    }
    this.temp = this.b / this.a;
    this.es = 1 - Math.pow(this.temp, 2);
    this.e3 = Math.sqrt(this.es);

    this.sin_po = Math.sin(this.lat1);
    this.cos_po = Math.cos(this.lat1);
    this.t1 = this.sin_po;
    this.con = this.sin_po;
    this.ms1 = proj4.common.msfnz(this.e3, this.sin_po, this.cos_po);
    this.qs1 = proj4.common.qsfnz(this.e3, this.sin_po, this.cos_po);

    this.sin_po = Math.sin(this.lat2);
    this.cos_po = Math.cos(this.lat2);
    this.t2 = this.sin_po;
    this.ms2 = proj4.common.msfnz(this.e3, this.sin_po, this.cos_po);
    this.qs2 = proj4.common.qsfnz(this.e3, this.sin_po, this.cos_po);

    this.sin_po = Math.sin(this.lat0);
    this.cos_po = Math.cos(this.lat0);
    this.t3 = this.sin_po;
    this.qs0 = proj4.common.qsfnz(this.e3, this.sin_po, this.cos_po);

    if (Math.abs(this.lat1 - this.lat2) > proj4.common.EPSLN) {
      this.ns0 = (this.ms1 * this.ms1 - this.ms2 * this.ms2) / (this.qs2 - this.qs1);
    }
    else {
      this.ns0 = this.con;
    }
    this.c = this.ms1 * this.ms1 + this.ns0 * this.qs1;
    this.rh = this.a * Math.sqrt(this.c - this.ns0 * this.qs0) / this.ns0;
  },

  /* Albers Conical Equal Area forward equations--mapping lat,long to x,y
  -------------------------------------------------------------------*/
  forward: function(p) {

    var lon = p.x;
    var lat = p.y;

    this.sin_phi = Math.sin(lat);
    this.cos_phi = Math.cos(lat);

    var qs = proj4.common.qsfnz(this.e3, this.sin_phi, this.cos_phi);
    var rh1 = this.a * Math.sqrt(this.c - this.ns0 * qs) / this.ns0;
    var theta = this.ns0 * proj4.common.adjust_lon(lon - this.long0);
    var x = rh1 * Math.sin(theta) + this.x0;
    var y = this.rh - rh1 * Math.cos(theta) + this.y0;

    p.x = x;
    p.y = y;
    return p;
  },


  inverse: function(p) {
    var rh1, qs, con, theta, lon, lat;

    p.x -= this.x0;
    p.y = this.rh - p.y + this.y0;
    if (this.ns0 >= 0) {
      rh1 = Math.sqrt(p.x * p.x + p.y * p.y);
      con = 1;
    }
    else {
      rh1 = -Math.sqrt(p.x * p.x + p.y * p.y);
      con = -1;
    }
    theta = 0;
    if (rh1 !== 0) {
      theta = Math.atan2(con * p.x, con * p.y);
    }
    con = rh1 * this.ns0 / this.a;
    if (this.sphere) {
      lat = Math.asin((this.c - con * con) / (2 * this.ns0));
    }
    else {
      qs = (this.c - con * con) / this.ns0;
      lat = this.phi1z(this.e3, qs);
    }

    lon = proj4.common.adjust_lon(theta / this.ns0 + this.long0);
    p.x = lon;
    p.y = lat;
    return p;
  },

  /* Function to compute phi1, the latitude for the inverse of the
   Albers Conical Equal-Area projection.
-------------------------------------------*/
  phi1z: function(eccent, qs) {
    var sinphi, cosphi, con, com, dphi;
    var phi = proj4.common.asinz(0.5 * qs);
    if (eccent < proj4.common.EPSLN){
      return phi;
    }

    var eccnts = eccent * eccent;
    for (var i = 1; i <= 25; i++) {
      sinphi = Math.sin(phi);
      cosphi = Math.cos(phi);
      con = eccent * sinphi;
      com = 1 - con * con;
      dphi = 0.5 * com * com / cosphi * (qs / (1 - eccnts) - sinphi / com + 0.5 / eccent * Math.log((1 - con) / (1 + con)));
      phi = phi + dphi;
      if (Math.abs(dphi) <= 1e-7){
        return phi;
      }
    }
    proj4.reportError("aea:phi1z:Convergence error");
    return null;
  }

};

proj4.Proj.aeqd = {

  init: function() {
    this.sin_p12 = Math.sin(this.lat0);
    this.cos_p12 = Math.cos(this.lat0);
  },

  forward: function(p) {
    var lon = p.x;
    var lat = p.y;
    var sinphi = Math.sin(p.y);
    var cosphi = Math.cos(p.y);
    var dlon = proj4.common.adjust_lon(lon - this.long0);
    var e0,e1,e2,e3,Mlp,Ml,tanphi,Nl1,Nl,psi,Az,G,H,GH,Hs,c,kp,cos_c,s,s2,s3,s4,s5;
    if (this.sphere) {
      if (Math.abs(this.sin_p12 - 1) <= proj4.common.EPSLN) {
        //North Pole case
        p.x = this.x0 + this.a * (proj4.common.HALF_PI - lat) * Math.sin(dlon);
        p.y = this.y0 - this.a * (proj4.common.HALF_PI - lat) * Math.cos(dlon);
        return p;
      }
      else if (Math.abs(this.sin_p12 + 1) <= proj4.common.EPSLN) {
        //South Pole case
        p.x = this.x0 + this.a * (proj4.common.HALF_PI + lat) * Math.sin(dlon);
        p.y = this.y0 + this.a * (proj4.common.HALF_PI + lat) * Math.cos(dlon);
        return p;
      }
      else {
        //default case
        cos_c = this.sin_p12 * sinphi + this.cos_p12 * cosphi * Math.cos(dlon);
        c = Math.acos(cos_c);
        kp = c / Math.sin(c);
        p.x = this.x0 + this.a * kp * cosphi * Math.sin(dlon);
        p.y = this.y0 + this.a * kp * (this.cos_p12 * sinphi - this.sin_p12 * cosphi * Math.cos(dlon));
        return p;
      }
    }
    else {
      e0 = proj4.common.e0fn(this.es);
      e1 = proj4.common.e1fn(this.es);
      e2 = proj4.common.e2fn(this.es);
      e3 = proj4.common.e3fn(this.es);
      if (Math.abs(this.sin_p12 - 1) <= proj4.common.EPSLN) {
        //North Pole case
        Mlp = this.a * proj4.common.mlfn(e0, e1, e2, e3, proj4.common.HALF_PI);
        Ml = this.a * proj4.common.mlfn(e0, e1, e2, e3, lat);
        p.x = this.x0 + (Mlp - Ml) * Math.sin(dlon);
        p.y = this.y0 - (Mlp - Ml) * Math.cos(dlon);
        return p;
      }
      else if (Math.abs(this.sin_p12 + 1) <= proj4.common.EPSLN) {
        //South Pole case
        Mlp = this.a * proj4.common.mlfn(e0, e1, e2, e3, proj4.common.HALF_PI);
        Ml = this.a * proj4.common.mlfn(e0, e1, e2, e3, lat);
        p.x = this.x0 + (Mlp + Ml) * Math.sin(dlon);
        p.y = this.y0 + (Mlp + Ml) * Math.cos(dlon);
        return p;
      }
      else {
        //Default case
        tanphi = sinphi / cosphi;
        Nl1 = proj4.common.gN(this.a, this.e, this.sin_p12);
        Nl = proj4.common.gN(this.a, this.e, sinphi);
        psi = Math.atan((1 - this.es) * tanphi + this.es * Nl1 * this.sin_p12 / (Nl * cosphi));
        Az = Math.atan2(Math.sin(dlon), this.cos_p12 * Math.tan(psi) - this.sin_p12 * Math.cos(dlon));
        if (Az === 0) {
          s = Math.asin(this.cos_p12 * Math.sin(psi) - this.sin_p12 * Math.cos(psi));
        }
        else if (Math.abs(Math.abs(Az) - proj4.common.PI) <= proj4.common.EPSLN) {
          s = -Math.asin(this.cos_p12 * Math.sin(psi) - this.sin_p12 * Math.cos(psi));
        }
        else {
          s = Math.asin(Math.sin(dlon) * Math.cos(psi) / Math.sin(Az));
        }
        G = this.e * this.sin_p12 / Math.sqrt(1 - this.es);
        H = this.e * this.cos_p12 * Math.cos(Az) / Math.sqrt(1 - this.es);
        GH = G * H;
        Hs = H * H;
        s2 = s * s;
        s3 = s2 * s;
        s4 = s3 * s;
        s5 = s4 * s;
        c = Nl1 * s * (1 - s2 * Hs * (1 - Hs) / 6 + s3 / 8 * GH * (1 - 2 * Hs) + s4 / 120 * (Hs * (4 - 7 * Hs) - 3 * G * G * (1 - 7 * Hs)) - s5 / 48 * GH);
        p.x = this.x0 + c * Math.sin(Az);
        p.y = this.y0 + c * Math.cos(Az);
        return p;
      }
    }


  },

  inverse: function(p) {
    p.x -= this.x0;
    p.y -= this.y0;
    var rh,z,sinz,cosz,lon,lat,con,e0,e1,e2,e3,Mlp,M,N1,psi,Az,cosAz,tmp,A,B,D,Ee,F;
    if (this.sphere) {
      rh = Math.sqrt(p.x * p.x + p.y * p.y);
      if (rh > (2 * proj4.common.HALF_PI * this.a)) {
        proj4.reportError("aeqdInvDataError");
        return;
      }
      z = rh / this.a;

      sinz = Math.sin(z);
      cosz = Math.cos(z);

      lon = this.long0;
      if (Math.abs(rh) <= proj4.common.EPSLN) {
        lat = this.lat0;
      }
      else {
        lat = proj4.common.asinz(cosz * this.sin_p12 + (p.y * sinz * this.cos_p12) / rh);
        con = Math.abs(this.lat0) - proj4.common.HALF_PI;
        if (Math.abs(con) <= proj4.common.EPSLN) {
          if (this.lat0 >= 0) {
            lon = proj4.common.adjust_lon(this.long0 + Math.atan2(p.x, - p.y));
          }
          else {
            lon = proj4.common.adjust_lon(this.long0 - Math.atan2(-p.x, p.y));
          }
        }
        else {
          /*con = cosz - this.sin_p12 * Math.sin(lat);
        if ((Math.abs(con) < proj4.common.EPSLN) && (Math.abs(p.x) < proj4.common.EPSLN)) {
          //no-op, just keep the lon value as is
        } else {
          var temp = Math.atan2((p.x * sinz * this.cos_p12), (con * rh));
          lon = proj4.common.adjust_lon(this.long0 + Math.atan2((p.x * sinz * this.cos_p12), (con * rh)));
        }*/
          lon = proj4.common.adjust_lon(this.long0 + Math.atan2(p.x * sinz, rh * this.cos_p12 * cosz - p.y * this.sin_p12 * sinz));
        }
      }

      p.x = lon;
      p.y = lat;
      return p;
    }
    else {
      e0 = proj4.common.e0fn(this.es);
      e1 = proj4.common.e1fn(this.es);
      e2 = proj4.common.e2fn(this.es);
      e3 = proj4.common.e3fn(this.es);
      if (Math.abs(this.sin_p12 - 1) <= proj4.common.EPSLN) {
        //North pole case
        Mlp = this.a * proj4.common.mlfn(e0, e1, e2, e3, proj4.common.HALF_PI);
        rh = Math.sqrt(p.x * p.x + p.y * p.y);
        M = Mlp - rh;
        lat = proj4.common.imlfn(M / this.a, e0, e1, e2, e3);
        lon = proj4.common.adjust_lon(this.long0 + Math.atan2(p.x, - 1 * p.y));
        p.x = lon;
        p.y = lat;
        return p;
      }
      else if (Math.abs(this.sin_p12 + 1) <= proj4.common.EPSLN) {
        //South pole case
        Mlp = this.a * proj4.common.mlfn(e0, e1, e2, e3, proj4.common.HALF_PI);
        rh = Math.sqrt(p.x * p.x + p.y * p.y);
        M = rh - Mlp;

        lat = proj4.common.imlfn(M / this.a, e0, e1, e2, e3);
        lon = proj4.common.adjust_lon(this.long0 + Math.atan2(p.x, p.y));
        p.x = lon;
        p.y = lat;
        return p;
      }
      else {
        //default case
        rh = Math.sqrt(p.x * p.x + p.y * p.y);
        Az = Math.atan2(p.x, p.y);
        N1 = proj4.common.gN(this.a, this.e, this.sin_p12);
        cosAz = Math.cos(Az);
        tmp = this.e * this.cos_p12 * cosAz;
        A = -tmp * tmp / (1 - this.es);
        B = 3 * this.es * (1 - A) * this.sin_p12 * this.cos_p12 * cosAz / (1 - this.es);
        D = rh / N1;
        Ee = D - A * (1 + A) * Math.pow(D, 3) / 6 - B * (1 + 3 * A) * Math.pow(D, 4) / 24;
        F = 1 - A * Ee * Ee / 2 - D * Ee * Ee * Ee / 6;
        psi = Math.asin(this.sin_p12 * Math.cos(Ee) + this.cos_p12 * Math.sin(Ee) * cosAz);
        lon = proj4.common.adjust_lon(this.long0 + Math.asin(Math.sin(Az) * Math.sin(Ee) / Math.cos(psi)));
        lat = Math.atan((1 - this.es * F * this.sin_p12 / Math.sin(psi)) * Math.tan(psi) / (1 - this.es));
        p.x = lon;
        p.y = lat;
        return p;
      }
    }

  }
};

/*******************************************************************************
NAME                            CASSINI

PURPOSE:  Transforms input longitude and latitude to Easting and
    Northing for the Cassini projection.  The
    longitude and latitude must be in radians.  The Easting
    and Northing values will be returned in meters.
    Ported from PROJ.4.


ALGORITHM REFERENCES

1.  Snyder, John P., "Map Projections--A Working Manual", U.S. Geological
    Survey Professional Paper 1395 (Supersedes USGS Bulletin 1532), United
    State Government Printing Office, Washington D.C., 1987.

2.  Snyder, John P. and Voxland, Philip M., "An Album of Map Projections",
    U.S. Geological Survey Professional Paper 1453 , United State Government
*******************************************************************************/


//proj4.defs["EPSG:28191"] = "+proj=cass +lat_0=31.73409694444445 +lon_0=35.21208055555556 +x_0=170251.555 +y_0=126867.909 +a=6378300.789 +b=6356566.435 +towgs84=-275.722,94.7824,340.894,-8.001,-4.42,-11.821,1 +units=m +no_defs";

// Initialize the Cassini projection
// -----------------------------------------------------------------

proj4.Proj.cass = {
  init: function() {
    if (!this.sphere) {
      this.e0 = proj4.common.e0fn(this.es);
      this.e1 = proj4.common.e1fn(this.es);
      this.e2 = proj4.common.e2fn(this.es);
      this.e3 = proj4.common.e3fn(this.es);
      this.ml0 = this.a * proj4.common.mlfn(this.e0, this.e1, this.e2, this.e3, this.lat0);
    }
  },



  /* Cassini forward equations--mapping lat,long to x,y
  -----------------------------------------------------------------------*/
  forward: function(p) {

    /* Forward equations
      -----------------*/
    var x, y;
    var lam = p.x;
    var phi = p.y;
    lam = proj4.common.adjust_lon(lam - this.long0);

    if (this.sphere) {
      x = this.a * Math.asin(Math.cos(phi) * Math.sin(lam));
      y = this.a * (Math.atan2(Math.tan(phi), Math.cos(lam)) - this.lat0);
    }
    else {
      //ellipsoid
      var sinphi = Math.sin(phi);
      var cosphi = Math.cos(phi);
      var nl = proj4.common.gN(this.a, this.e, sinphi);
      var tl = Math.tan(phi) * Math.tan(phi);
      var al = lam * Math.cos(phi);
      var asq = al * al;
      var cl = this.es * cosphi * cosphi / (1 - this.es);
      var ml = this.a * proj4.common.mlfn(this.e0, this.e1, this.e2, this.e3, phi);

      x = nl * al * (1 - asq * tl * (1 / 6 - (8 - tl + 8 * cl) * asq / 120));
      y = ml - this.ml0 + nl * sinphi / cosphi * asq * (0.5 + (5 - tl + 6 * cl) * asq / 24);


    }

    p.x = x + this.x0;
    p.y = y + this.y0;
    return p;
  }, //cassFwd()

  /* Inverse equations
  -----------------*/
  inverse: function(p) {
    p.x -= this.x0;
    p.y -= this.y0;
    var x = p.x / this.a;
    var y = p.y / this.a;
    var phi, lam;

    if (this.sphere) {
      var dd = y + this.lat0;
      phi = Math.asin(Math.sin(dd) * Math.cos(x));
      lam = Math.atan2(Math.tan(x), Math.cos(dd));
    }
    else {
      /* ellipsoid */
      var ml1 = this.ml0 / this.a + y;
      var phi1 = proj4.common.imlfn(ml1, this.e0, this.e1, this.e2, this.e3);
      if (Math.abs(Math.abs(phi1) - proj4.common.HALF_PI) <= proj4.common.EPSLN) {
        p.x = this.long0;
        p.y = proj4.common.HALF_PI;
        if (y < 0) {
          p.y *= -1;
        }
        return p;
      }
      var nl1 = proj4.common.gN(this.a, this.e, Math.sin(phi1));

      var rl1 = nl1 * nl1 * nl1 / this.a / this.a * (1 - this.es);
      var tl1 = Math.pow(Math.tan(phi1), 2);
      var dl = x * this.a / nl1;
      var dsq = dl * dl;
      phi = phi1 - nl1 * Math.tan(phi1) / rl1 * dl * dl * (0.5 - (1 + 3 * tl1) * dl * dl / 24);
      lam = dl * (1 - dsq * (tl1 / 3 + (1 + 3 * tl1) * tl1 * dsq / 15)) / Math.cos(phi1);

    }

    p.x = proj4.common.adjust_lon(lam + this.long0);
    p.y = proj4.common.adjust_lat(phi);
    return p;

  } //cassInv()

};

/*******************************************************************************
NAME                    LAMBERT CYLINDRICAL EQUAL AREA

PURPOSE:  Transforms input longitude and latitude to Easting and
    Northing for the Lambert Cylindrical Equal Area projection.
                This class of projection includes the Behrmann and 
                Gall-Peters Projections.  The
    longitude and latitude must be in radians.  The Easting
    and Northing values will be returned in meters.

PROGRAMMER              DATE            
----------              ----
R. Marsden              August 2009
Winwaed Software Tech LLC, http://www.winwaed.com

This function was adapted from the Miller Cylindrical Projection in the Proj4JS
library.

Note: This implementation assumes a Spherical Earth. The (commented) code 
has been included for the ellipsoidal forward transform, but derivation of 
the ellispoidal inverse transform is beyond me. Note that most of the 
Proj4JS implementations do NOT currently support ellipsoidal figures. 
Therefore this is not seen as a problem - especially this lack of support 
is explicitly stated here.
 
ALGORITHM REFERENCES

1.  "Cartographic Projection Procedures for the UNIX Environment - 
     A User's Manual" by Gerald I. Evenden, USGS Open File Report 90-284
    and Release 4 Interim Reports (2003)

2.  Snyder, John P., "Flattening the Earth - Two Thousand Years of Map 
    Projections", Univ. Chicago Press, 1993
*******************************************************************************/

proj4.Proj.cea = {

  /* Initialize the Cylindrical Equal Area projection
  -------------------------------------------*/
  init: function() {
    //no-op
    if (!this.sphere) {
      this.k0 = proj4.common.msfnz(this.e, Math.sin(this.lat_ts), Math.cos(this.lat_ts));
    }
  },


  /* Cylindrical Equal Area forward equations--mapping lat,long to x,y
    ------------------------------------------------------------*/
  forward: function(p) {
    var lon = p.x;
    var lat = p.y;
    var x, y;
    /* Forward equations
      -----------------*/
    var dlon = proj4.common.adjust_lon(lon - this.long0);
    if (this.sphere) {
      x = this.x0 + this.a * dlon * Math.cos(this.lat_ts);
      y = this.y0 + this.a * Math.sin(lat) / Math.cos(this.lat_ts);
    }
    else {
      var qs = proj4.common.qsfnz(this.e, Math.sin(lat));
      x = this.x0 + this.a * this.k0 * dlon;
      y = this.y0 + this.a * qs * 0.5 / this.k0;
    }

    p.x = x;
    p.y = y;
    return p;
  }, //ceaFwd()

  /* Cylindrical Equal Area inverse equations--mapping x,y to lat/long
    ------------------------------------------------------------*/
  inverse: function(p) {
    p.x -= this.x0;
    p.y -= this.y0;
    var lon, lat;

    if (this.sphere) {
      lon = proj4.common.adjust_lon(this.long0 + (p.x / this.a) / Math.cos(this.lat_ts));
      lat = Math.asin((p.y / this.a) * Math.cos(this.lat_ts));
    }
    else {
      lat = proj4.common.iqsfnz(this.e, 2 * p.y * this.k0 / this.a);
      lon = proj4.common.adjust_lon(this.long0 + p.x / (this.a * this.k0));
    }

    p.x = lon;
    p.y = lat;
    return p;
  } //ceaInv()
};

/* similar to equi.js FIXME proj4 uses eqc */
proj4.Proj.eqc = {
  init: function() {

    this.x0 = this.x0||0;
    this.y0 = this.y0||0;
    this.lat0 = this.lat0||0;
    this.long0 = this.long0||0;
    this.lat_ts = this.lat_t||0;
    this.title = this.title||"Equidistant Cylindrical (Plate Carre)";

    this.rc = Math.cos(this.lat_ts);
  },


  // forward equations--mapping lat,long to x,y
  // -----------------------------------------------------------------
  forward: function(p) {

    var lon = p.x;
    var lat = p.y;

    var dlon = proj4.common.adjust_lon(lon - this.long0);
    var dlat = proj4.common.adjust_lat(lat - this.lat0);
    p.x = this.x0 + (this.a * dlon * this.rc);
    p.y = this.y0 + (this.a * dlat);
    return p;
  },

  // inverse equations--mapping x,y to lat/long
  // -----------------------------------------------------------------
  inverse: function(p) {

    var x = p.x;
    var y = p.y;

    p.x = proj4.common.adjust_lon(this.long0 + ((x - this.x0) / (this.a * this.rc)));
    p.y = proj4.common.adjust_lat(this.lat0 + ((y - this.y0) / (this.a)));
    return p;
  }

};

/*******************************************************************************
NAME                            EQUIDISTANT CONIC 

PURPOSE:  Transforms input longitude and latitude to Easting and Northing
    for the Equidistant Conic projection.  The longitude and
    latitude must be in radians.  The Easting and Northing values
    will be returned in meters.

PROGRAMMER              DATE
----------              ----
T. Mittan    Mar, 1993

ALGORITHM REFERENCES

1.  Snyder, John P., "Map Projections--A Working Manual", U.S. Geological
    Survey Professional Paper 1395 (Supersedes USGS Bulletin 1532), United
    State Government Printing Office, Washington D.C., 1987.

2.  Snyder, John P. and Voxland, Philip M., "An Album of Map Projections",
    U.S. Geological Survey Professional Paper 1453 , United State Government
    Printing Office, Washington D.C., 1989.
*******************************************************************************/

/* Variables common to all subroutines in this code file
  -----------------------------------------------------*/

proj4.Proj.eqdc = {

  /* Initialize the Equidistant Conic projection
  ------------------------------------------*/
  init: function() {

    /* Place parameters in static storage for common use
      -------------------------------------------------*/
    // Standard Parallels cannot be equal and on opposite sides of the equator
    if (Math.abs(this.lat1 + this.lat2) < proj4.common.EPSLN) {
      proj4.common.reportError("eqdc:init: Equal Latitudes");
      return;
    }
    this.lat2 = this.lat2||this.lat1;
    this.temp = this.b / this.a;
    this.es = 1 - Math.pow(this.temp, 2);
    this.e = Math.sqrt(this.es);
    this.e0 = proj4.common.e0fn(this.es);
    this.e1 = proj4.common.e1fn(this.es);
    this.e2 = proj4.common.e2fn(this.es);
    this.e3 = proj4.common.e3fn(this.es);

    this.sinphi = Math.sin(this.lat1);
    this.cosphi = Math.cos(this.lat1);

    this.ms1 = proj4.common.msfnz(this.e, this.sinphi, this.cosphi);
    this.ml1 = proj4.common.mlfn(this.e0, this.e1, this.e2, this.e3, this.lat1);

    if (Math.abs(this.lat1 - this.lat2) < proj4.common.EPSLN) {
      this.ns = this.sinphi;
      proj4.reportError("eqdc:Init:EqualLatitudes");
    }
    else {
      this.sinphi = Math.sin(this.lat2);
      this.cosphi = Math.cos(this.lat2);
      this.ms2 = proj4.common.msfnz(this.e, this.sinphi, this.cosphi);
      this.ml2 = proj4.common.mlfn(this.e0, this.e1, this.e2, this.e3, this.lat2);
      this.ns = (this.ms1 - this.ms2) / (this.ml2 - this.ml1);
    }
    this.g = this.ml1 + this.ms1 / this.ns;
    this.ml0 = proj4.common.mlfn(this.e0, this.e1, this.e2, this.e3, this.lat0);
    this.rh = this.a * (this.g - this.ml0);
  },


  /* Equidistant Conic forward equations--mapping lat,long to x,y
  -----------------------------------------------------------*/
  forward: function(p) {
    var lon = p.x;
    var lat = p.y;
    var rh1;

    /* Forward equations
      -----------------*/
    if (this.sphere) {
      rh1 = this.a * (this.g - lat);
    }
    else {
      var ml = proj4.common.mlfn(this.e0, this.e1, this.e2, this.e3, lat);
      rh1 = this.a * (this.g - ml);
    }
    var theta = this.ns * proj4.common.adjust_lon(lon - this.long0);
    var x = this.x0 + rh1 * Math.sin(theta);
    var y = this.y0 + this.rh - rh1 * Math.cos(theta);
    p.x = x;
    p.y = y;
    return p;
  },

  /* Inverse equations
  -----------------*/
  inverse: function(p) {
    p.x -= this.x0;
    p.y = this.rh - p.y + this.y0;
    var con, rh1, lat, lon;
    if (this.ns >= 0) {
      rh1 = Math.sqrt(p.x * p.x + p.y * p.y);
      con = 1;
    }
    else {
      rh1 = -Math.sqrt(p.x * p.x + p.y * p.y);
      con = -1;
    }
    var theta = 0;
    if (rh1 !== 0) {
      theta = Math.atan2(con * p.x, con * p.y);
    }

    if (this.sphere) {
      lon = proj4.common.adjust_lon(this.long0 + theta / this.ns);
      lat = proj4.common.adjust_lat(this.g - rh1 / this.a);
      p.x = lon;
      p.y = lat;
      return p;
    }
    else {
      var ml = this.g - rh1 / this.a;
      lat = proj4.common.imlfn(ml, this.e0, this.e1, this.e2, this.e3);
      lon = proj4.common.adjust_lon(this.long0 + theta / this.ns);
      p.x = lon;
      p.y = lat;
      return p;
    }

  }




};
/*******************************************************************************
NAME                             EQUIRECTANGULAR 

PURPOSE:  Transforms input longitude and latitude to Easting and
    Northing for the Equirectangular projection.  The
    longitude and latitude must be in radians.  The Easting
    and Northing values will be returned in meters.

PROGRAMMER              DATE
----------              ----
T. Mittan    Mar, 1993

ALGORITHM REFERENCES

1.  Snyder, John P., "Map Projections--A Working Manual", U.S. Geological
    Survey Professional Paper 1395 (Supersedes USGS Bulletin 1532), United
    State Government Printing Office, Washington D.C., 1987.

2.  Snyder, John P. and Voxland, Philip M., "An Album of Map Projections",
    U.S. Geological Survey Professional Paper 1453 , United State Government
    Printing Office, Washington D.C., 1989.
*******************************************************************************/
proj4.Proj.equi = {

  init: function() {
    this.x0 = this.x0||0;
    this.y0 = this.y0||0;
    this.lat0 = this.lat0||0;
    this.long0 = this.long0||0;
    ///this.t2;
  },



  /* Equirectangular forward equations--mapping lat,long to x,y
  ---------------------------------------------------------*/
  forward: function(p) {

    var lon = p.x;
    var lat = p.y;

    var dlon = proj4.common.adjust_lon(lon - this.long0);
    var x = this.x0 + this.a * dlon * Math.cos(this.lat0);
    var y = this.y0 + this.a * lat;

    this.t1 = x;
    this.t2 = Math.cos(this.lat0);
    p.x = x;
    p.y = y;
    return p;
  }, //equiFwd()



  /* Equirectangular inverse equations--mapping x,y to lat/long
  ---------------------------------------------------------*/
  inverse: function(p) {

    p.x -= this.x0;
    p.y -= this.y0;
    var lat = p.y / this.a;

    if (Math.abs(lat) > proj4.common.HALF_PI) {
      proj4.reportError("equi:Inv:DataError");
    }
    var lon = proj4.common.adjust_lon(this.long0 + p.x / (this.a * Math.cos(this.lat0)));
    p.x = lon;
    p.y = lat;
  } //equiInv()
};

proj4.Proj.gauss = {

  init: function() {
    var sphi = Math.sin(this.lat0);
    var cphi = Math.cos(this.lat0);
    cphi *= cphi;
    this.rc = Math.sqrt(1 - this.es) / (1 - this.es * sphi * sphi);
    this.C = Math.sqrt(1 + this.es * cphi * cphi / (1 - this.es));
    this.phic0 = Math.asin(sphi / this.C);
    this.ratexp = 0.5 * this.C * this.e;
    this.K = Math.tan(0.5 * this.phic0 + proj4.common.FORTPI) / (Math.pow(Math.tan(0.5 * this.lat0 + proj4.common.FORTPI), this.C) * proj4.common.srat(this.e * sphi, this.ratexp));
  },

  forward: function(p) {
    var lon = p.x;
    var lat = p.y;

    p.y = 2 * Math.atan(this.K * Math.pow(Math.tan(0.5 * lat + proj4.common.FORTPI), this.C) * proj4.common.srat(this.e * Math.sin(lat), this.ratexp)) - proj4.common.HALF_PI;
    p.x = this.C * lon;
    return p;
  },

  inverse: function(p) {
    var DEL_TOL = 1e-14;
    var lon = p.x / this.C;
    var lat = p.y;
    var num = Math.pow(Math.tan(0.5 * lat + proj4.common.FORTPI) / this.K, 1 / this.C);
    for (var i = proj4.common.MAX_ITER; i > 0; --i) {
      lat = 2 * Math.atan(num * proj4.common.srat(this.e * Math.sin(p.y), - 0.5 * this.e)) - proj4.common.HALF_PI;
      if (Math.abs(lat - p.y) < DEL_TOL){
        break;
      }
      p.y = lat;
    }
    /* convergence failed */
    if (!i) {
      proj4.reportError("gauss:inverse:convergence failed");
      return null;
    }
    p.x = lon;
    p.y = lat;
    return p;
  }
};

/*****************************************************************************
NAME                             GNOMONIC

PURPOSE:  Transforms input longitude and latitude to Easting and
    Northing for the Gnomonic Projection.
                Implementation based on the existing sterea and ortho
                implementations.

PROGRAMMER              DATE
----------              ----
Richard Marsden         November 2009

ALGORITHM REFERENCES

1.  Snyder, John P., "Flattening the Earth - Two Thousand Years of Map 
    Projections", University of Chicago Press 1993

2.  Wolfram Mathworld "Gnomonic Projection"
    http://mathworld.wolfram.com/GnomonicProjection.html
    Accessed: 12th November 2009
******************************************************************************/

proj4.Proj.gnom = {

  /* Initialize the Gnomonic projection
    -------------------------------------*/
  init: function() {

    /* Place parameters in static storage for common use
      -------------------------------------------------*/
    this.sin_p14 = Math.sin(this.lat0);
    this.cos_p14 = Math.cos(this.lat0);
    // Approximation for projecting points to the horizon (infinity)
    this.infinity_dist = 1000 * this.a;
    this.rc = 1;
  },


  /* Gnomonic forward equations--mapping lat,long to x,y
    ---------------------------------------------------*/
  forward: function(p) {
    var sinphi, cosphi; /* sin and cos value        */
    var dlon; /* delta longitude value      */
    var coslon; /* cos of longitude        */
    var ksp; /* scale factor          */
    var g;
    var x, y;
    var lon = p.x;
    var lat = p.y;
    /* Forward equations
      -----------------*/
    dlon = proj4.common.adjust_lon(lon - this.long0);

    sinphi = Math.sin(lat);
    cosphi = Math.cos(lat);

    coslon = Math.cos(dlon);
    g = this.sin_p14 * sinphi + this.cos_p14 * cosphi * coslon;
    ksp = 1;
    if ((g > 0) || (Math.abs(g) <= proj4.common.EPSLN)) {
      x = this.x0 + this.a * ksp * cosphi * Math.sin(dlon) / g;
      y = this.y0 + this.a * ksp * (this.cos_p14 * sinphi - this.sin_p14 * cosphi * coslon) / g;
    }
    else {
      proj4.reportError("orthoFwdPointError");

      // Point is in the opposing hemisphere and is unprojectable
      // We still need to return a reasonable point, so we project 
      // to infinity, on a bearing 
      // equivalent to the northern hemisphere equivalent
      // This is a reasonable approximation for short shapes and lines that 
      // straddle the horizon.

      x = this.x0 + this.infinity_dist * cosphi * Math.sin(dlon);
      y = this.y0 + this.infinity_dist * (this.cos_p14 * sinphi - this.sin_p14 * cosphi * coslon);

    }
    p.x = x;
    p.y = y;
    return p;
  },


  inverse: function(p) {
    var rh; /* Rho */
    var sinc, cosc;
    var c;
    var lon, lat;

    /* Inverse equations
      -----------------*/
    p.x = (p.x - this.x0) / this.a;
    p.y = (p.y - this.y0) / this.a;

    p.x /= this.k0;
    p.y /= this.k0;

    if ((rh = Math.sqrt(p.x * p.x + p.y * p.y))) {
      c = Math.atan2(rh, this.rc);
      sinc = Math.sin(c);
      cosc = Math.cos(c);

      lat = proj4.common.asinz(cosc * this.sin_p14 + (p.y * sinc * this.cos_p14) / rh);
      lon = Math.atan2(p.x * sinc, rh * this.cos_p14 * cosc - p.y * this.sin_p14 * sinc);
      lon = proj4.common.adjust_lon(this.long0 + lon);
    }
    else {
      lat = this.phic0;
      lon = 0;
    }

    p.x = lon;
    p.y = lat;
    return p;
  }
};

proj4.Proj.gstmerc = {
  init: function() {

    // array of:  a, b, lon0, lat0, k0, x0, y0
    var temp = this.b / this.a;
    this.e = Math.sqrt(1 - temp * temp);
    this.lc = this.long0;
    this.rs = Math.sqrt(1 + this.e * this.e * Math.pow(Math.cos(this.lat0), 4) / (1 - this.e * this.e));
    var sinz = Math.sin(this.lat0);
    var pc = Math.asin(sinz / this.rs);
    var sinzpc = Math.sin(pc);
    this.cp = proj4.common.latiso(0, pc, sinzpc) - this.rs * proj4.common.latiso(this.e, this.lat0, sinz);
    this.n2 = this.k0 * this.a * Math.sqrt(1 - this.e * this.e) / (1 - this.e * this.e * sinz * sinz);
    this.xs = this.x0;
    this.ys = this.y0 - this.n2 * pc;

    if (!this.title){
      this.title = "Gauss Schreiber transverse mercator";
    }
  },


  // forward equations--mapping lat,long to x,y
  // -----------------------------------------------------------------
  forward: function(p) {

    var lon = p.x;
    var lat = p.y;

    var L = this.rs * (lon - this.lc);
    var Ls = this.cp + (this.rs * proj4.common.latiso(this.e, lat, Math.sin(lat)));
    var lat1 = Math.asin(Math.sin(L) / proj4.common.cosh(Ls));
    var Ls1 = proj4.common.latiso(0, lat1, Math.sin(lat1));
    p.x = this.xs + (this.n2 * Ls1);
    p.y = this.ys + (this.n2 * Math.atan(proj4.common.sinh(Ls) / Math.cos(L)));
    return p;
  },

  // inverse equations--mapping x,y to lat/long
  // -----------------------------------------------------------------
  inverse: function(p) {

    var x = p.x;
    var y = p.y;

    var L = Math.atan(proj4.common.sinh((x - this.xs) / this.n2) / Math.cos((y - this.ys) / this.n2));
    var lat1 = Math.asin(Math.sin((y - this.ys) / this.n2) / proj4.common.cosh((x - this.xs) / this.n2));
    var LC = proj4.common.latiso(0, lat1, Math.sin(lat1));
    p.x = this.lc + L / this.rs;
    p.y = proj4.common.invlatiso(this.e, (LC - this.cp) / this.rs);
    return p;
  }

};

/**
   NOTES: According to EPSG the full Krovak projection method should have
          the following parameters.  Within PROJ.4 the azimuth, and pseudo
          standard parallel are hardcoded in the algorithm and can't be 
          altered from outside.  The others all have defaults to match the
          common usage with Krovak projection.

  lat_0 = latitude of centre of the projection
         
  lon_0 = longitude of centre of the projection
  
  ** = azimuth (true) of the centre line passing through the centre of the projection

  ** = latitude of pseudo standard parallel
   
  k  = scale factor on the pseudo standard parallel
  
  x_0 = False Easting of the centre of the projection at the apex of the cone
  
  y_0 = False Northing of the centre of the projection at the apex of the cone

 **/

proj4.Proj.krovak = {

  init: function() {
    /* we want Bessel as fixed ellipsoid */
    this.a = 6377397.155;
    this.es = 0.006674372230614;
    this.e = Math.sqrt(this.es);
    /* if latitude of projection center is not set, use 49d30'N */
    if (!this.lat0) {
      this.lat0 = 0.863937979737193;
    }
    if (!this.long0) {
      this.long0 = 0.7417649320975901 - 0.308341501185665;
    }
    /* if scale not set default to 0.9999 */
    if (!this.k0) {
      this.k0 = 0.9999;
    }
    this.s45 = 0.785398163397448; /* 45 */
    this.s90 = 2 * this.s45;
    this.fi0 = this.lat0; /* Latitude of projection centre 49  30' */
    /*  Ellipsoid Bessel 1841 a = 6377397.155m 1/f = 299.1528128,
                 e2=0.006674372230614;
     */
    this.e2 = this.es; /* 0.006674372230614; */
    this.e = Math.sqrt(this.e2);
    this.alfa = Math.sqrt(1 + (this.e2 * Math.pow(Math.cos(this.fi0), 4)) / (1 - this.e2));
    this.uq = 1.04216856380474; /* DU(2, 59, 42, 42.69689) */
    this.u0 = Math.asin(Math.sin(this.fi0) / this.alfa);
    this.g = Math.pow((1 + this.e * Math.sin(this.fi0)) / (1 - this.e * Math.sin(this.fi0)), this.alfa * this.e / 2);
    this.k = Math.tan(this.u0 / 2 + this.s45) / Math.pow(Math.tan(this.fi0 / 2 + this.s45), this.alfa) * this.g;
    this.k1 = this.k0;
    this.n0 = this.a * Math.sqrt(1 - this.e2) / (1 - this.e2 * Math.pow(Math.sin(this.fi0), 2));
    this.s0 = 1.37008346281555; /* Latitude of pseudo standard parallel 78 30'00" N */
    this.n = Math.sin(this.s0);
    this.ro0 = this.k1 * this.n0 / Math.tan(this.s0);
    this.ad = this.s90 - this.uq;
  },

  /* ellipsoid */
  /* calculate xy from lat/lon */
  /* Constants, identical to inverse transform function */
  forward: function(p) {
    var gfi, u, deltav, s, d, eps, ro;
    var lon = p.x;
    var lat = p.y;
    var delta_lon = proj4.common.adjust_lon(lon - this.long0); // Delta longitude
    /* Transformation */
    gfi = Math.pow(((1 + this.e * Math.sin(lat)) / (1 - this.e * Math.sin(lat))), (this.alfa * this.e / 2));
    u = 2 * (Math.atan(this.k * Math.pow(Math.tan(lat / 2 + this.s45), this.alfa) / gfi) - this.s45);
    deltav = -delta_lon * this.alfa;
    s = Math.asin(Math.cos(this.ad) * Math.sin(u) + Math.sin(this.ad) * Math.cos(u) * Math.cos(deltav));
    d = Math.asin(Math.cos(u) * Math.sin(deltav) / Math.cos(s));
    eps = this.n * d;
    ro = this.ro0 * Math.pow(Math.tan(this.s0 / 2 + this.s45), this.n) / Math.pow(Math.tan(s / 2 + this.s45), this.n);
    /* x and y are reverted! */
    //p.y = ro * Math.cos(eps) / a;
    //p.x = ro * Math.sin(eps) / a;
    p.y = ro * Math.cos(eps) / 1;
    p.x = ro * Math.sin(eps) / 1;

    if (!this.czech) {
      p.y *= -1;
      p.x *= -1;
    }
    return (p);
  },

  /* calculate lat/lon from xy */
  inverse: function(p) {
    /* Constants, identisch wie in der Umkehrfunktion */
    var u, deltav, s, d, eps, ro, fi1;
    var ok;

    /* Transformation */
    /* revert y, x*/
    var tmp = p.x;
    p.x = p.y;
    p.y = tmp;
    if (!this.czech) {
      p.y *= -1;
      p.x *= -1;
    }
    ro = Math.sqrt(p.x * p.x + p.y * p.y);
    eps = Math.atan2(p.y, p.x);
    d = eps / Math.sin(this.s0);
    s = 2 * (Math.atan(Math.pow(this.ro0 / ro, 1 / this.n) * Math.tan(this.s0 / 2 + this.s45)) - this.s45);
    u = Math.asin(Math.cos(this.ad) * Math.sin(s) - Math.sin(this.ad) * Math.cos(s) * Math.cos(d));
    deltav = Math.asin(Math.cos(s) * Math.sin(d) / Math.cos(u));
    p.x = this.long0 - deltav / this.alfa;
    /* ITERATION FOR lat */
    fi1 = u;
    ok = 0;
    var iter = 0;
    do {
      p.y = 2 * (Math.atan(Math.pow(this.k, - 1 / this.alfa) * Math.pow(Math.tan(u / 2 + this.s45), 1 / this.alfa) * Math.pow((1 + this.e * Math.sin(fi1)) / (1 - this.e * Math.sin(fi1)), this.e / 2)) - this.s45);
      if (Math.abs(fi1 - p.y) < 0.0000000001){
        ok = 1;
      }
      fi1 = p.y;
      iter += 1;
    } while (ok === 0 && iter < 15);
    if (iter >= 15) {
      proj4.reportError("PHI3Z-CONV:Latitude failed to converge after 15 iterations");
      //console.log('iter:', iter);
      return null;
    }

    return (p);
  }
};

/*******************************************************************************
NAME                  LAMBERT AZIMUTHAL EQUAL-AREA
 
PURPOSE:  Transforms input longitude and latitude to Easting and
    Northing for the Lambert Azimuthal Equal-Area projection.  The
    longitude and latitude must be in radians.  The Easting
    and Northing values will be returned in meters.

PROGRAMMER              DATE            
----------              ----           
D. Steinwand, EROS      March, 1991   

This function was adapted from the Lambert Azimuthal Equal Area projection
code (FORTRAN) in the General Cartographic Transformation Package software
which is available from the U.S. Geological Survey National Mapping Division.
 
ALGORITHM REFERENCES

1.  "New Equal-Area Map Projections for Noncircular Regions", John P. Snyder,
    The American Cartographer, Vol 15, No. 4, October 1988, pp. 341-355.

2.  Snyder, John P., "Map Projections--A Working Manual", U.S. Geological
    Survey Professional Paper 1395 (Supersedes USGS Bulletin 1532), United
    State Government Printing Office, Washington D.C., 1987.

3.  "Software Documentation for GCTP General Cartographic Transformation
    Package", U.S. Geological Survey National Mapping Division, May 1982.
*******************************************************************************/

proj4.Proj.laea = {
  S_POLE: 1,
  N_POLE: 2,
  EQUIT: 3,
  OBLIQ: 4,


  /* Initialize the Lambert Azimuthal Equal Area projection
  ------------------------------------------------------*/
  init: function() {
    var t = Math.abs(this.lat0);
    if (Math.abs(t - proj4.common.HALF_PI) < proj4.common.EPSLN) {
      this.mode = this.lat0 < 0 ? this.S_POLE : this.N_POLE;
    }
    else if (Math.abs(t) < proj4.common.EPSLN) {
      this.mode = this.EQUIT;
    }
    else {
      this.mode = this.OBLIQ;
    }
    if (this.es > 0) {
      var sinphi;

      this.qp = proj4.common.qsfnz(this.e, 1);
      this.mmf = 0.5 / (1 - this.es);
      this.apa = this.authset(this.es);
      switch (this.mode) {
      case this.N_POLE:
        this.dd = 1;
        break;
      case this.S_POLE:
        this.dd = 1;
        break;
      case this.EQUIT:
        this.rq = Math.sqrt(0.5 * this.qp);
        this.dd = 1 / this.rq;
        this.xmf = 1;
        this.ymf = 0.5 * this.qp;
        break;
      case this.OBLIQ:
        this.rq = Math.sqrt(0.5 * this.qp);
        sinphi = Math.sin(this.lat0);
        this.sinb1 = proj4.common.qsfnz(this.e, sinphi) / this.qp;
        this.cosb1 = Math.sqrt(1 - this.sinb1 * this.sinb1);
        this.dd = Math.cos(this.lat0) / (Math.sqrt(1 - this.es * sinphi * sinphi) * this.rq * this.cosb1);
        this.ymf = (this.xmf = this.rq) / this.dd;
        this.xmf *= this.dd;
        break;
      }
    }
    else {
      if (this.mode === this.OBLIQ) {
        this.sinph0 = Math.sin(this.lat0);
        this.cosph0 = Math.cos(this.lat0);
      }
    }
  },

  /* Lambert Azimuthal Equal Area forward equations--mapping lat,long to x,y
  -----------------------------------------------------------------------*/
  forward: function(p) {

    /* Forward equations
      -----------------*/
    var x, y,coslam, sinlam, sinphi, q, sinb,cosb,b,cosphi;
    var lam = p.x;
    var phi = p.y;
    
    lam = proj4.common.adjust_lon(lam - this.long0);

    if (this.sphere) {
      sinphi = Math.sin(phi);
      cosphi = Math.cos(phi);
      coslam = Math.cos(lam);
      if(this.mode === this.OBLIQ || this.mode === this.EQUIT){
        y = (this.mode === this.EQUIT) ? 1 + cosphi * coslam : 1 + this.sinph0 * sinphi + this.cosph0 * cosphi * coslam;
        if (y <= proj4.common.EPSLN) {
          proj4.reportError("laea:fwd:y less than eps");
          return null;
        }
        y = Math.sqrt(2 / y);
        x = y * cosphi * Math.sin(lam);
        y *= (this.mode === this.EQUIT) ? sinphi : this.cosph0 * sinphi - this.sinph0 * cosphi * coslam;
      } else if(this.mode === this.N_POLE|| this.mode === this.S_POLE){
        if(this.mode === this.N_POLE){
          coslam = -coslam;
        }
        if (Math.abs(phi + this.phi0) < proj4.common.EPSLN) {
          proj4.reportError("laea:fwd:phi < eps");
          return null;
        }
        y = proj4.common.FORTPI - phi * 0.5;
        y = 2 * ((this.mode === this.S_POLE) ? Math.cos(y) : Math.sin(y));
        x = y * Math.sin(lam);
        y *= coslam;
      }
    }
    else {
      sinb = 0;
      cosb = 0;
      b = 0;
      coslam = Math.cos(lam);
      sinlam = Math.sin(lam);
      sinphi = Math.sin(phi);
      q = proj4.common.qsfnz(this.e, sinphi);
      if (this.mode === this.OBLIQ || this.mode === this.EQUIT) {
        sinb = q / this.qp;
        cosb = Math.sqrt(1 - sinb * sinb);
      }
      switch (this.mode) {
      case this.OBLIQ:
        b = 1 + this.sinb1 * sinb + this.cosb1 * cosb * coslam;
        break;
      case this.EQUIT:
        b = 1 + cosb * coslam;
        break;
      case this.N_POLE:
        b = proj4.common.HALF_PI + phi;
        q = this.qp - q;
        break;
      case this.S_POLE:
        b = phi - proj4.common.HALF_PI;
        q = this.qp + q;
        break;
      }
      if (Math.abs(b) < proj4.common.EPSLN) {
        proj4.reportError("laea:fwd:b < eps");
        return null;
      }
      switch (this.mode) {
      case this.OBLIQ:
      case this.EQUIT:
        b = Math.sqrt(2 / b);
        if (this.mode === this.OBLIQ) {
          y = this.ymf * b * (this.cosb1 * sinb - this.sinb1 * cosb * coslam);
        }
        else {
          y = (b = Math.sqrt(2 / (1 + cosb * coslam))) * sinb * this.ymf;
        }
        x = this.xmf * b * cosb * sinlam;
        break;
      case this.N_POLE:
      case this.S_POLE:
        if (q >= 0) {
          x = (b = Math.sqrt(q)) * sinlam;
          y = coslam * ((this.mode === this.S_POLE) ? b : -b);
        }
        else {
          x = y = 0;
        }
        break;
      }
    }

    //v 1
    /*
    var sin_lat=Math.sin(lat);
    var cos_lat=Math.cos(lat);

    var sin_delta_lon=Math.sin(delta_lon);
    var cos_delta_lon=Math.cos(delta_lon);

    var g =this.sin_lat_o * sin_lat +this.cos_lat_o * cos_lat * cos_delta_lon;
    if (g == -1) {
      proj4.reportError("laea:fwd:Point projects to a circle of radius "+ 2 * R);
      return null;
    }
    var ksp = this.a * Math.sqrt(2 / (1 + g));
    var x = ksp * cos_lat * sin_delta_lon + this.x0;
    var y = ksp * (this.cos_lat_o * sin_lat - this.sin_lat_o * cos_lat * cos_delta_lon) + this.y0;
    */
    p.x = this.a * x + this.x0;
    p.y = this.a * y + this.y0;
    return p;
  }, //lamazFwd()

  /* Inverse equations
  -----------------*/
  inverse: function(p) {
    p.x -= this.x0;
    p.y -= this.y0;
    var x = p.x / this.a;
    var y = p.y / this.a;
    var lam, phi, cCe, sCe, q, rho, ab;

    if (this.sphere) {
      var cosz = 0,
        rh, sinz = 0;

      rh = Math.sqrt(x * x + y * y);
      phi = rh * 0.5;
      if (phi > 1) {
        proj4.reportError("laea:Inv:DataError");
        return null;
      }
      phi = 2 * Math.asin(phi);
      if (this.mode === this.OBLIQ || this.mode === this.EQUIT) {
        sinz = Math.sin(phi);
        cosz = Math.cos(phi);
      }
      switch (this.mode) {
      case this.EQUIT:
        phi = (Math.abs(rh) <= proj4.common.EPSLN) ? 0 : Math.asin(y * sinz / rh);
        x *= sinz;
        y = cosz * rh;
        break;
      case this.OBLIQ:
        phi = (Math.abs(rh) <= proj4.common.EPSLN) ? this.phi0 : Math.asin(cosz * this.sinph0 + y * sinz * this.cosph0 / rh);
        x *= sinz * this.cosph0;
        y = (cosz - Math.sin(phi) * this.sinph0) * rh;
        break;
      case this.N_POLE:
        y = -y;
        phi = proj4.common.HALF_PI - phi;
        break;
      case this.S_POLE:
        phi -= proj4.common.HALF_PI;
        break;
      }
      lam = (y === 0 && (this.mode === this.EQUIT || this.mode === this.OBLIQ)) ? 0 : Math.atan2(x, y);
    }
    else {
      ab = 0;
      if(this.mode === this.OBLIQ || this.mode === this.EQUIT){
        x /= this.dd;
        y *= this.dd;
        rho = Math.sqrt(x * x + y * y);
        if (rho < proj4.common.EPSLN) {
          p.x = 0;
          p.y = this.phi0;
          return p;
        }
        sCe = 2 * Math.asin(0.5 * rho / this.rq);
        cCe = Math.cos(sCe);
        x *= (sCe = Math.sin(sCe));
        if (this.mode === this.OBLIQ) {
          ab = cCe * this.sinb1 + y * sCe * this.cosb1 / rho;
          q = this.qp * ab;
          y = rho * this.cosb1 * cCe - y * this.sinb1 * sCe;
        }
        else {
          ab = y * sCe / rho;
          q = this.qp * ab;
          y = rho * cCe;
        }
      }else if(this.mode === this.N_POLE || this.mode === this.S_POLE){
        if(this.mode === this.N_POLE){
          y = -y;
        }
        q = (x * x + y * y);
        if (!q) {
          p.x = 0;
          p.y = this.phi0;
          return p;
        }
        /*
          q = this.qp - q;
          */
        ab = 1 - q / this.qp;
        if (this.mode === this.S_POLE) {
          ab = -ab;
        }
      }
      lam = Math.atan2(x, y);
      phi = this.authlat(Math.asin(ab), this.apa);
    }

    /*
    var Rh = Math.Math.sqrt(p.x *p.x +p.y * p.y);
    var temp = Rh / (2 * this.a);

    if (temp > 1) {
      proj4.reportError("laea:Inv:DataError");
      return null;
    }

    var z = 2 * proj4.common.asinz(temp);
    var sin_z=Math.sin(z);
    var cos_z=Math.cos(z);

    var lon =this.long0;
    if (Math.abs(Rh) > proj4.common.EPSLN) {
       var lat = proj4.common.asinz(this.sin_lat_o * cos_z +this. cos_lat_o * sin_z *p.y / Rh);
       var temp =Math.abs(this.lat0) - proj4.common.HALF_PI;
       if (Math.abs(temp) > proj4.common.EPSLN) {
          temp = cos_z -this.sin_lat_o * Math.sin(lat);
          if(temp!=0) lon=proj4.common.adjust_lon(this.long0+Math.atan2(p.x*sin_z*this.cos_lat_o,temp*Rh));
       } else if (this.lat0 < 0) {
          lon = proj4.common.adjust_lon(this.long0 - Math.atan2(-p.x,p.y));
       } else {
          lon = proj4.common.adjust_lon(this.long0 + Math.atan2(p.x, -p.y));
       }
    } else {
      lat = this.lat0;
    }
    */
    //return(OK);
    p.x = proj4.common.adjust_lon(this.long0 + lam);
    p.y = phi;
    return p;
  }, //lamazInv()

  /* determine latitude from authalic latitude */
  P00: 0.33333333333333333333,
  P01: 0.17222222222222222222,
  P02: 0.10257936507936507936,
  P10: 0.06388888888888888888,
  P11: 0.06640211640211640211,
  P20: 0.01641501294219154443,

  authset: function(es) {
    var t;
    var APA = [];
    APA[0] = es * this.P00;
    t = es * es;
    APA[0] += t * this.P01;
    APA[1] = t * this.P10;
    t *= es;
    APA[0] += t * this.P02;
    APA[1] += t * this.P11;
    APA[2] = t * this.P20;
    return APA;
  },

  authlat: function(beta, APA) {
    var t = beta + beta;
    return (beta + APA[0] * Math.sin(t) + APA[1] * Math.sin(t + t) + APA[2] * Math.sin(t + t + t));
  }

};

/*******************************************************************************
NAME                            LAMBERT CONFORMAL CONIC

PURPOSE:  Transforms input longitude and latitude to Easting and
    Northing for the Lambert Conformal Conic projection.  The
    longitude and latitude must be in radians.  The Easting
    and Northing values will be returned in meters.


ALGORITHM REFERENCES

1.  Snyder, John P., "Map Projections--A Working Manual", U.S. Geological
    Survey Professional Paper 1395 (Supersedes USGS Bulletin 1532), United
    State Government Printing Office, Washington D.C., 1987.

2.  Snyder, John P. and Voxland, Philip M., "An Album of Map Projections",
    U.S. Geological Survey Professional Paper 1453 , United State Government
*******************************************************************************/


//<2104> +proj=lcc +lat_1=10.16666666666667 +lat_0=10.16666666666667 +lon_0=-71.60561777777777 +k_0=1 +x0=-17044 +x0=-23139.97 +ellps=intl +units=m +no_defs  no_defs

// Initialize the Lambert Conformal conic projection
// -----------------------------------------------------------------

//proj4.Proj.lcc = Class.create();
proj4.Proj.lcc = {
  init: function() {

    // array of:  r_maj,r_min,lat1,lat2,c_lon,c_lat,false_east,false_north
    //double c_lat;                   /* center latitude                      */
    //double c_lon;                   /* center longitude                     */
    //double lat1;                    /* first standard parallel              */
    //double lat2;                    /* second standard parallel             */
    //double r_maj;                   /* major axis                           */
    //double r_min;                   /* minor axis                           */
    //double false_east;              /* x offset in meters                   */
    //double false_north;             /* y offset in meters                   */

    if (!this.lat2) {
      this.lat2 = this.lat1;
    } //if lat2 is not defined
    if (!this.k0){
      this.k0 = 1;
    }

    // Standard Parallels cannot be equal and on opposite sides of the equator
    if (Math.abs(this.lat1 + this.lat2) < proj4.common.EPSLN) {
      proj4.reportError("lcc:init: Equal Latitudes");
      return;
    }

    var temp = this.b / this.a;
    this.e = Math.sqrt(1 - temp * temp);

    var sin1 = Math.sin(this.lat1);
    var cos1 = Math.cos(this.lat1);
    var ms1 = proj4.common.msfnz(this.e, sin1, cos1);
    var ts1 = proj4.common.tsfnz(this.e, this.lat1, sin1);

    var sin2 = Math.sin(this.lat2);
    var cos2 = Math.cos(this.lat2);
    var ms2 = proj4.common.msfnz(this.e, sin2, cos2);
    var ts2 = proj4.common.tsfnz(this.e, this.lat2, sin2);

    var ts0 = proj4.common.tsfnz(this.e, this.lat0, Math.sin(this.lat0));

    if (Math.abs(this.lat1 - this.lat2) > proj4.common.EPSLN) {
      this.ns = Math.log(ms1 / ms2) / Math.log(ts1 / ts2);
    }
    else {
      this.ns = sin1;
    }
    this.f0 = ms1 / (this.ns * Math.pow(ts1, this.ns));
    this.rh = this.a * this.f0 * Math.pow(ts0, this.ns);
    if (!this.title){
      this.title = "Lambert Conformal Conic";
    }
  },


  // Lambert Conformal conic forward equations--mapping lat,long to x,y
  // -----------------------------------------------------------------
  forward: function(p) {

    var lon = p.x;
    var lat = p.y;

    // singular cases :
    if (Math.abs(2 * Math.abs(lat) - proj4.common.PI) <= proj4.common.EPSLN) {
      lat = proj4.common.sign(lat) * (proj4.common.HALF_PI - 2 * proj4.common.EPSLN);
    }

    var con = Math.abs(Math.abs(lat) - proj4.common.HALF_PI);
    var ts, rh1;
    if (con > proj4.common.EPSLN) {
      ts = proj4.common.tsfnz(this.e, lat, Math.sin(lat));
      rh1 = this.a * this.f0 * Math.pow(ts, this.ns);
    }
    else {
      con = lat * this.ns;
      if (con <= 0) {
        proj4.reportError("lcc:forward: No Projection");
        return null;
      }
      rh1 = 0;
    }
    var theta = this.ns * proj4.common.adjust_lon(lon - this.long0);
    p.x = this.k0 * (rh1 * Math.sin(theta)) + this.x0;
    p.y = this.k0 * (this.rh - rh1 * Math.cos(theta)) + this.y0;

    return p;
  },

  // Lambert Conformal Conic inverse equations--mapping x,y to lat/long
  // -----------------------------------------------------------------
  inverse: function(p) {

    var rh1, con, ts;
    var lat, lon;
    var x = (p.x - this.x0) / this.k0;
    var y = (this.rh - (p.y - this.y0) / this.k0);
    if (this.ns > 0) {
      rh1 = Math.sqrt(x * x + y * y);
      con = 1;
    }
    else {
      rh1 = -Math.sqrt(x * x + y * y);
      con = -1;
    }
    var theta = 0;
    if (rh1 !== 0) {
      theta = Math.atan2((con * x), (con * y));
    }
    if ((rh1 !== 0) || (this.ns > 0)) {
      con = 1 / this.ns;
      ts = Math.pow((rh1 / (this.a * this.f0)), con);
      lat = proj4.common.phi2z(this.e, ts);
      if (lat === -9999){
        return null;
      }
    }
    else {
      lat = -proj4.common.HALF_PI;
    }
    lon = proj4.common.adjust_lon(theta / this.ns + this.long0);

    p.x = lon;
    p.y = lat;
    return p;
  }
};

/*******************************************************************************
NAME                            MERCATOR

PURPOSE:  Transforms input longitude and latitude to Easting and
    Northing for the Mercator projection.  The
    longitude and latitude must be in radians.  The Easting
    and Northing values will be returned in meters.

PROGRAMMER              DATE
----------              ----
D. Steinwand, EROS      Nov, 1991
T. Mittan    Mar, 1993

ALGORITHM REFERENCES

1.  Snyder, John P., "Map Projections--A Working Manual", U.S. Geological
    Survey Professional Paper 1395 (Supersedes USGS Bulletin 1532), United
    State Government Printing Office, Washington D.C., 1987.

2.  Snyder, John P. and Voxland, Philip M., "An Album of Map Projections",
    U.S. Geological Survey Professional Paper 1453 , United State Government
    Printing Office, Washington D.C., 1989.
*******************************************************************************/

//static double r_major = a;       /* major axis         */
//static double r_minor = b;       /* minor axis         */
//static double lon_center = long0;     /* Center longitude (projection center) */
//static double lat_origin =  lat0;     /* center latitude      */
//static double e,es;               /* eccentricity constants    */
//static double m1;                   /* small value m      */
//static double false_northing = y0;   /* y offset in meters      */
//static double false_easting = x0;     /* x offset in meters      */
//scale_fact = k0 

proj4.Proj.merc = {
  init: function() {
    var con = this.b / this.a;
    this.es = 1 - con * con;
    this.e = Math.sqrt(this.es);
    if (this.lat_ts) {
      if (this.sphere) {
        this.k0 = Math.cos(this.lat_ts);
      }
      else {
        this.k0 = proj4.common.msfnz(this.e, Math.sin(this.lat_ts), Math.cos(this.lat_ts));
      }
    }
    else {
      if (!this.k0) {
        if (this.k) {
          this.k0 = this.k;
        }
        else {
          this.k0 = 1;
        }
      }
    }
  },

  /* Mercator forward equations--mapping lat,long to x,y
  --------------------------------------------------*/

  forward: function(p) {
    //alert("ll2m coords : "+coords);
    var lon = p.x;
    var lat = p.y;
    // convert to radians
    if (lat * proj4.common.R2D > 90 && lat * proj4.common.R2D < -90 && lon * proj4.common.R2D > 180 && lon * proj4.common.R2D < -180) {
      proj4.reportError("merc:forward: llInputOutOfRange: " + lon + " : " + lat);
      return null;
    }

    var x, y;
    if (Math.abs(Math.abs(lat) - proj4.common.HALF_PI) <= proj4.common.EPSLN) {
      proj4.reportError("merc:forward: ll2mAtPoles");
      return null;
    }
    else {
      if (this.sphere) {
        x = this.x0 + this.a * this.k0 * proj4.common.adjust_lon(lon - this.long0);
        y = this.y0 + this.a * this.k0 * Math.log(Math.tan(proj4.common.FORTPI + 0.5 * lat));
      }
      else {
        var sinphi = Math.sin(lat);
        var ts = proj4.common.tsfnz(this.e, lat, sinphi);
        x = this.x0 + this.a * this.k0 * proj4.common.adjust_lon(lon - this.long0);
        y = this.y0 - this.a * this.k0 * Math.log(ts);
      }
      p.x = x;
      p.y = y;
      return p;
    }
  },


  /* Mercator inverse equations--mapping x,y to lat/long
  --------------------------------------------------*/
  inverse: function(p) {

    var x = p.x - this.x0;
    var y = p.y - this.y0;
    var lon, lat;

    if (this.sphere) {
      lat = proj4.common.HALF_PI - 2 * Math.atan(Math.exp(-y / (this.a * this.k0)));
    }
    else {
      var ts = Math.exp(-y / (this.a * this.k0));
      lat = proj4.common.phi2z(this.e, ts);
      if (lat === -9999) {
        proj4.reportError("merc:inverse: lat = -9999");
        return null;
      }
    }
    lon = proj4.common.adjust_lon(this.long0 + x / (this.a * this.k0));

    p.x = lon;
    p.y = lat;
    return p;
  }
};

/*******************************************************************************
NAME                    MILLER CYLINDRICAL 

PURPOSE:  Transforms input longitude and latitude to Easting and
    Northing for the Miller Cylindrical projection.  The
    longitude and latitude must be in radians.  The Easting
    and Northing values will be returned in meters.

PROGRAMMER              DATE            
----------              ----           
T. Mittan    March, 1993

This function was adapted from the Lambert Azimuthal Equal Area projection
code (FORTRAN) in the General Cartographic Transformation Package software
which is available from the U.S. Geological Survey National Mapping Division.
 
ALGORITHM REFERENCES

1.  "New Equal-Area Map Projections for Noncircular Regions", John P. Snyder,
    The American Cartographer, Vol 15, No. 4, October 1988, pp. 341-355.

2.  Snyder, John P., "Map Projections--A Working Manual", U.S. Geological
    Survey Professional Paper 1395 (Supersedes USGS Bulletin 1532), United
    State Government Printing Office, Washington D.C., 1987.

3.  "Software Documentation for GCTP General Cartographic Transformation
    Package", U.S. Geological Survey National Mapping Division, May 1982.
*******************************************************************************/

proj4.Proj.mill = {

  /* Initialize the Miller Cylindrical projection
  -------------------------------------------*/
  init: function() {
    //no-op
  },


  /* Miller Cylindrical forward equations--mapping lat,long to x,y
    ------------------------------------------------------------*/
  forward: function(p) {
    var lon = p.x;
    var lat = p.y;
    /* Forward equations
      -----------------*/
    var dlon = proj4.common.adjust_lon(lon - this.long0);
    var x = this.x0 + this.a * dlon;
    var y = this.y0 + this.a * Math.log(Math.tan((proj4.common.PI / 4) + (lat / 2.5))) * 1.25;

    p.x = x;
    p.y = y;
    return p;
  }, //millFwd()

  /* Miller Cylindrical inverse equations--mapping x,y to lat/long
    ------------------------------------------------------------*/
  inverse: function(p) {
    p.x -= this.x0;
    p.y -= this.y0;

    var lon = proj4.common.adjust_lon(this.long0 + p.x / this.a);
    var lat = 2.5 * (Math.atan(Math.exp(0.8 * p.y / this.a)) - proj4.common.PI / 4);

    p.x = lon;
    p.y = lat;
    return p;
  } //millInv()
};

/*******************************************************************************
NAME                            MOLLWEIDE

PURPOSE:  Transforms input longitude and latitude to Easting and
    Northing for the MOllweide projection.  The
    longitude and latitude must be in radians.  The Easting
    and Northing values will be returned in meters.

PROGRAMMER              DATE
----------              ----
D. Steinwand, EROS      May, 1991;  Updated Sept, 1992; Updated Feb, 1993
S. Nelson, EDC    Jun, 2993;  Made corrections in precision and
          number of iterations.

ALGORITHM REFERENCES

1.  Snyder, John P. and Voxland, Philip M., "An Album of Map Projections",
    U.S. Geological Survey Professional Paper 1453 , United State Government
    Printing Office, Washington D.C., 1989.

2.  Snyder, John P., "Map Projections--A Working Manual", U.S. Geological
    Survey Professional Paper 1395 (Supersedes USGS Bulletin 1532), United
    State Government Printing Office, Washington D.C., 1987.
*******************************************************************************/

proj4.Proj.moll = {

  /* Initialize the Mollweide projection
    ------------------------------------*/
  init: function() {
    //no-op
  },

  /* Mollweide forward equations--mapping lat,long to x,y
    ----------------------------------------------------*/
  forward: function(p) {

    /* Forward equations
      -----------------*/
    var lon = p.x;
    var lat = p.y;

    var delta_lon = proj4.common.adjust_lon(lon - this.long0);
    var theta = lat;
    var con = proj4.common.PI * Math.sin(lat);

    /* Iterate using the Newton-Raphson method to find theta
      -----------------------------------------------------*/
    for (var i = 0; true; i++) {
      var delta_theta = -(theta + Math.sin(theta) - con) / (1 + Math.cos(theta));
      theta += delta_theta;
      if (Math.abs(delta_theta) < proj4.common.EPSLN){
        break;
      }
      if (i >= 50) {
        proj4.reportError("moll:Fwd:IterationError");
        //return(241);
      }
    }
    theta /= 2;

    /* If the latitude is 90 deg, force the x coordinate to be "0 + false easting"
       this is done here because of precision problems with "cos(theta)"
       --------------------------------------------------------------------------*/
    if (proj4.common.PI / 2 - Math.abs(lat) < proj4.common.EPSLN){
      delta_lon = 0;
    }
    var x = 0.900316316158 * this.a * delta_lon * Math.cos(theta) + this.x0;
    var y = 1.4142135623731 * this.a * Math.sin(theta) + this.y0;

    p.x = x;
    p.y = y;
    return p;
  },

  inverse: function(p) {
    var theta;
    var arg;

    /* Inverse equations
      -----------------*/
    p.x -= this.x0;
    p.y -= this.y0;
    arg = p.y / (1.4142135623731 * this.a);

    /* Because of division by zero problems, 'arg' can not be 1.  Therefore
       a number very close to one is used instead.
       -------------------------------------------------------------------*/
    if (Math.abs(arg) > 0.999999999999){
      arg = 0.999999999999;
    }
    theta = Math.asin(arg);
    var lon = proj4.common.adjust_lon(this.long0 + (p.x / (0.900316316158 * this.a * Math.cos(theta))));
    if (lon < (-proj4.common.PI)){
      lon = -proj4.common.PI;
    }
    if (lon > proj4.common.PI){
      lon = proj4.common.PI;
    }
    arg = (2 * theta + Math.sin(2 * theta)) / proj4.common.PI;
    if (Math.abs(arg) > 1){
      arg = 1;
    }
    var lat = Math.asin(arg);
    //return(OK);

    p.x = lon;
    p.y = lat;
    return p;
  }
};

/*******************************************************************************
NAME                            NEW ZEALAND MAP GRID

PURPOSE:  Transforms input longitude and latitude to Easting and
    Northing for the New Zealand Map Grid projection.  The
    longitude and latitude must be in radians.  The Easting
    and Northing values will be returned in meters.


ALGORITHM REFERENCES

1.  Department of Land and Survey Technical Circular 1973/32
      http://www.linz.govt.nz/docs/miscellaneous/nz-map-definition.pdf

2.  OSG Technical Report 4.1
      http://www.linz.govt.nz/docs/miscellaneous/nzmg.pdf


IMPLEMENTATION NOTES

The two references use different symbols for the calculated values. This
implementation uses the variable names similar to the symbols in reference [1].

The alogrithm uses different units for delta latitude and delta longitude.
The delta latitude is assumed to be in units of seconds of arc x 10^-5.
The delta longitude is the usual radians. Look out for these conversions.

The algorithm is described using complex arithmetic. There were three
options:
   * find and use a Javascript library for complex arithmetic
   * write my own complex library
   * expand the complex arithmetic by hand to simple arithmetic

This implementation has expanded the complex multiplication operations
into parallel simple arithmetic operations for the real and imaginary parts.
The imaginary part is way over to the right of the display; this probably
violates every coding standard in the world, but, to me, it makes it much
more obvious what is going on.

The following complex operations are used:
   - addition
   - multiplication
   - division
   - complex number raised to integer power
   - summation

A summary of complex arithmetic operations:
   (from http://en.wikipedia.org/wiki/Complex_arithmetic)
   addition:       (a + bi) + (c + di) = (a + c) + (b + d)i
   subtraction:    (a + bi) - (c + di) = (a - c) + (b - d)i
   multiplication: (a + bi) x (c + di) = (ac - bd) + (bc + ad)i
   division:       (a + bi) / (c + di) = [(ac + bd)/(cc + dd)] + [(bc - ad)/(cc + dd)]i

The algorithm needs to calculate summations of simple and complex numbers. This is
implemented using a for-loop, pre-loading the summed value to zero.

The algorithm needs to calculate theta^2, theta^3, etc while doing a summation.
There are three possible implementations:
   - use Math.pow in the summation loop - except for complex numbers
   - precalculate the values before running the loop
   - calculate theta^n = theta^(n-1) * theta during the loop
This implementation uses the third option for both real and complex arithmetic.

For example
   psi_n = 1;
   sum = 0;
   for (n = 1; n <=6; n++) {
      psi_n1 = psi_n * psi;       // calculate psi^(n+1)
      psi_n = psi_n1;
      sum = sum + A[n] * psi_n;
   }


TEST VECTORS

NZMG E, N:         2487100.638      6751049.719     metres
NZGD49 long, lat:      172.739194       -34.444066  degrees

NZMG E, N:         2486533.395      6077263.661     metres
NZGD49 long, lat:      172.723106       -40.512409  degrees

NZMG E, N:         2216746.425      5388508.765     metres
NZGD49 long, lat:      169.172062       -46.651295  degrees

Note that these test vectors convert from NZMG metres to lat/long referenced
to NZGD49, not the more usual WGS84. The difference is about 70m N/S and about
10m E/W.

These test vectors are provided in reference [1]. Many more test
vectors are available in
   http://www.linz.govt.nz/docs/topography/topographicdata/placenamesdatabase/nznamesmar08.zip
which is a catalog of names on the 260-series maps.


EPSG CODES

NZMG     EPSG:27200
NZGD49   EPSG:4272

http://spatialreference.org/ defines these as
  proj4.defs["EPSG:4272"] = "+proj=longlat +ellps=intl +datum=nzgd49 +no_defs ";
  proj4.defs["EPSG:27200"] = "+proj=nzmg +lat_0=-41 +lon_0=173 +x_0=2510000 +y_0=6023150 +ellps=intl +datum=nzgd49 +units=m +no_defs ";


LICENSE
  Copyright: Stephen Irons 2008
  Released under terms of the LGPL as per: http://www.gnu.org/copyleft/lesser.html

*******************************************************************************/


/**
  Initialize New Zealand Map Grip projection
*/

proj4.Proj.nzmg = {

  /**
   * iterations: Number of iterations to refine inverse transform.
   *     0 -> km accuracy
   *     1 -> m accuracy -- suitable for most mapping applications
   *     2 -> mm accuracy
   */
  iterations: 1,

  init: function() {
    this.A = [];
    this.A[1] = 0.6399175073;
    this.A[2] = -0.1358797613;
    this.A[3] = 0.063294409;
    this.A[4] = -0.02526853;
    this.A[5] = 0.0117879;
    this.A[6] = -0.0055161;
    this.A[7] = 0.0026906;
    this.A[8] = -0.001333;
    this.A[9] = 0.00067;
    this.A[10] = -0.00034;

    this.B_re = [];
    this.B_im = [];
    this.B_re[1] = 0.7557853228;
    this.B_im[1] = 0;
    this.B_re[2] = 0.249204646;
    this.B_im[2] = 0.003371507;
    this.B_re[3] = -0.001541739;
    this.B_im[3] = 0.041058560;
    this.B_re[4] = -0.10162907;
    this.B_im[4] = 0.01727609;
    this.B_re[5] = -0.26623489;
    this.B_im[5] = -0.36249218;
    this.B_re[6] = -0.6870983;
    this.B_im[6] = -1.1651967;

    this.C_re = [];
    this.C_im = [];
    this.C_re[1] = 1.3231270439;
    this.C_im[1] = 0;
    this.C_re[2] = -0.577245789;
    this.C_im[2] = -0.007809598;
    this.C_re[3] = 0.508307513;
    this.C_im[3] = -0.112208952;
    this.C_re[4] = -0.15094762;
    this.C_im[4] = 0.18200602;
    this.C_re[5] = 1.01418179;
    this.C_im[5] = 1.64497696;
    this.C_re[6] = 1.9660549;
    this.C_im[6] = 2.5127645;

    this.D = [];
    this.D[1] = 1.5627014243;
    this.D[2] = 0.5185406398;
    this.D[3] = -0.03333098;
    this.D[4] = -0.1052906;
    this.D[5] = -0.0368594;
    this.D[6] = 0.007317;
    this.D[7] = 0.01220;
    this.D[8] = 0.00394;
    this.D[9] = -0.0013;
  },

  /**
    New Zealand Map Grid Forward  - long/lat to x/y
    long/lat in radians
  */
  forward: function(p) {
    var n;
    var lon = p.x;
    var lat = p.y;

    var delta_lat = lat - this.lat0;
    var delta_lon = lon - this.long0;

    // 1. Calculate d_phi and d_psi    ...                          // and d_lambda
    // For this algorithm, delta_latitude is in seconds of arc x 10-5, so we need to scale to those units. Longitude is radians.
    var d_phi = delta_lat / proj4.common.SEC_TO_RAD * 1E-5;
    var d_lambda = delta_lon;
    var d_phi_n = 1; // d_phi^0

    var d_psi = 0;
    for (n = 1; n <= 10; n++) {
      d_phi_n = d_phi_n * d_phi;
      d_psi = d_psi + this.A[n] * d_phi_n;
    }

    // 2. Calculate theta
    var th_re = d_psi;
    var th_im = d_lambda;

    // 3. Calculate z
    var th_n_re = 1;
    var th_n_im = 0; // theta^0
    var th_n_re1;
    var th_n_im1;

    var z_re = 0;
    var z_im = 0;
    for (n = 1; n <= 6; n++) {
      th_n_re1 = th_n_re * th_re - th_n_im * th_im;
      th_n_im1 = th_n_im * th_re + th_n_re * th_im;
      th_n_re = th_n_re1;
      th_n_im = th_n_im1;
      z_re = z_re + this.B_re[n] * th_n_re - this.B_im[n] * th_n_im;
      z_im = z_im + this.B_im[n] * th_n_re + this.B_re[n] * th_n_im;
    }

    // 4. Calculate easting and northing
    p.x = (z_im * this.a) + this.x0;
    p.y = (z_re * this.a) + this.y0;

    return p;
  },


  /**
    New Zealand Map Grid Inverse  -  x/y to long/lat
  */
  inverse: function(p) {
    var n;
    var x = p.x;
    var y = p.y;

    var delta_x = x - this.x0;
    var delta_y = y - this.y0;

    // 1. Calculate z
    var z_re = delta_y / this.a;
    var z_im = delta_x / this.a;

    // 2a. Calculate theta - first approximation gives km accuracy
    var z_n_re = 1;
    var z_n_im = 0; // z^0
    var z_n_re1;
    var z_n_im1;

    var th_re = 0;
    var th_im = 0;
    for (n = 1; n <= 6; n++) {
      z_n_re1 = z_n_re * z_re - z_n_im * z_im;
      z_n_im1 = z_n_im * z_re + z_n_re * z_im;
      z_n_re = z_n_re1;
      z_n_im = z_n_im1;
      th_re = th_re + this.C_re[n] * z_n_re - this.C_im[n] * z_n_im;
      th_im = th_im + this.C_im[n] * z_n_re + this.C_re[n] * z_n_im;
    }

    // 2b. Iterate to refine the accuracy of the calculation
    //        0 iterations gives km accuracy
    //        1 iteration gives m accuracy -- good enough for most mapping applications
    //        2 iterations bives mm accuracy
    for (var i = 0; i < this.iterations; i++) {
      var th_n_re = th_re;
      var th_n_im = th_im;
      var th_n_re1;
      var th_n_im1;

      var num_re = z_re;
      var num_im = z_im;
      for (n = 2; n <= 6; n++) {
        th_n_re1 = th_n_re * th_re - th_n_im * th_im;
        th_n_im1 = th_n_im * th_re + th_n_re * th_im;
        th_n_re = th_n_re1;
        th_n_im = th_n_im1;
        num_re = num_re + (n - 1) * (this.B_re[n] * th_n_re - this.B_im[n] * th_n_im);
        num_im = num_im + (n - 1) * (this.B_im[n] * th_n_re + this.B_re[n] * th_n_im);
      }

      th_n_re = 1;
      th_n_im = 0;
      var den_re = this.B_re[1];
      var den_im = this.B_im[1];
      for (n = 2; n <= 6; n++) {
        th_n_re1 = th_n_re * th_re - th_n_im * th_im;
        th_n_im1 = th_n_im * th_re + th_n_re * th_im;
        th_n_re = th_n_re1;
        th_n_im = th_n_im1;
        den_re = den_re + n * (this.B_re[n] * th_n_re - this.B_im[n] * th_n_im);
        den_im = den_im + n * (this.B_im[n] * th_n_re + this.B_re[n] * th_n_im);
      }

      // Complex division
      var den2 = den_re * den_re + den_im * den_im;
      th_re = (num_re * den_re + num_im * den_im) / den2;
      th_im = (num_im * den_re - num_re * den_im) / den2;
    }

    // 3. Calculate d_phi              ...                                    // and d_lambda
    var d_psi = th_re;
    var d_lambda = th_im;
    var d_psi_n = 1; // d_psi^0

    var d_phi = 0;
    for (n = 1; n <= 9; n++) {
      d_psi_n = d_psi_n * d_psi;
      d_phi = d_phi + this.D[n] * d_psi_n;
    }

    // 4. Calculate latitude and longitude
    // d_phi is calcuated in second of arc * 10^-5, so we need to scale back to radians. d_lambda is in radians.
    var lat = this.lat0 + (d_phi * proj4.common.SEC_TO_RAD * 1E5);
    var lon = this.long0 + d_lambda;

    p.x = lon;
    p.y = lat;

    return p;
  }
};

/*******************************************************************************
NAME                       OBLIQUE MERCATOR (HOTINE) 

PURPOSE:  Transforms input longitude and latitude to Easting and
    Northing for the Oblique Mercator projection.  The
    longitude and latitude must be in radians.  The Easting
    and Northing values will be returned in meters.

PROGRAMMER              DATE
----------              ----
T. Mittan    Mar, 1993

ALGORITHM REFERENCES

1.  Snyder, John P., "Map Projections--A Working Manual", U.S. Geological
    Survey Professional Paper 1395 (Supersedes USGS Bulletin 1532), United
    State Government Printing Office, Washington D.C., 1987.

2.  Snyder, John P. and Voxland, Philip M., "An Album of Map Projections",
    U.S. Geological Survey Professional Paper 1453 , United State Government
    Printing Office, Washington D.C., 1989.
*******************************************************************************/

proj4.Proj.omerc = {

  /* Initialize the Oblique Mercator  projection
    ------------------------------------------*/
  init: function() {
    this.no_off = this.no_off||false;
    this.no_rot = this.no_rot||false;

    if (isNaN(this.k0)){
      this.k0 = 1;
    }
    var sinlat = Math.sin(this.lat0);
    var coslat = Math.cos(this.lat0);
    var con = this.e * sinlat;

    this.bl = Math.sqrt(1 + this.es / (1 - this.es) * Math.pow(coslat, 4));
    this.al = this.a * this.bl * this.k0 * Math.sqrt(1 - this.es) / (1 - con * con);
    var t0 = proj4.common.tsfnz(this.e, this.lat0, sinlat);
    var dl = this.bl / coslat * Math.sqrt((1 - this.es) / (1 - con * con));
    if (dl * dl < 1){
      dl = 1;
    }
    var fl;
    var gl;
    if (!isNaN(this.longc)) {
      //Central point and azimuth method

      if (this.lat0 >= 0) {
        fl = dl + Math.sqrt(dl * dl - 1);
      }
      else {
        fl = dl - Math.sqrt(dl * dl - 1);
      }
      this.el = fl * Math.pow(t0, this.bl);
      gl = 0.5 * (fl - 1 / fl);
      this.gamma0 = Math.asin(Math.sin(this.alpha) / dl);
      this.long0 = this.longc - Math.asin(gl * Math.tan(this.gamma0)) / this.bl;

    }
    else {
      //2 points method
      var t1 = proj4.common.tsfnz(this.e, this.lat1, Math.sin(this.lat1));
      var t2 = proj4.common.tsfnz(this.e, this.lat2, Math.sin(this.lat2));
      if (this.lat0 >= 0) {
        this.el = (dl + Math.sqrt(dl * dl - 1)) * Math.pow(t0, this.bl);
      }
      else {
        this.el = (dl - Math.sqrt(dl * dl - 1)) * Math.pow(t0, this.bl);
      }
      var hl = Math.pow(t1, this.bl);
      var ll = Math.pow(t2, this.bl);
      fl = this.el / hl;
      gl = 0.5 * (fl - 1 / fl);
      var jl = (this.el * this.el - ll * hl) / (this.el * this.el + ll * hl);
      var pl = (ll - hl) / (ll + hl);
      var dlon12 = proj4.common.adjust_lon(this.long1 - this.long2);
      this.long0 = 0.5 * (this.long1 + this.long2) - Math.atan(jl * Math.tan(0.5 * this.bl * (dlon12)) / pl) / this.bl;
      this.long0 = proj4.common.adjust_lon(this.long0);
      var dlon10 = proj4.common.adjust_lon(this.long1 - this.long0);
      this.gamma0 = Math.atan(Math.sin(this.bl * (dlon10)) / gl);
      this.alpha = Math.asin(dl * Math.sin(this.gamma0));
    }

    if (this.no_off) {
      this.uc = 0;
    }
    else {
      if (this.lat0 >= 0) {
        this.uc = this.al / this.bl * Math.atan2(Math.sqrt(dl * dl - 1), Math.cos(this.alpha));
      }
      else {
        this.uc = -1 * this.al / this.bl * Math.atan2(Math.sqrt(dl * dl - 1), Math.cos(this.alpha));
      }
    }

  },


  /* Oblique Mercator forward equations--mapping lat,long to x,y
    ----------------------------------------------------------*/
  forward: function(p) {
    var lon = p.x;
    var lat = p.y;
    var dlon = proj4.common.adjust_lon(lon - this.long0);
    var us, vs;
    var con;
    if (Math.abs(Math.abs(lat) - proj4.common.HALF_PI) <= proj4.common.EPSLN) {
      if (lat > 0) {
        con = -1;
      }
      else {
        con = 1;
      }
      vs = this.al / this.bl * Math.log(Math.tan(proj4.common.FORTPI + con * this.gamma0 * 0.5));
      us = -1 * con * proj4.common.HALF_PI * this.al / this.bl;
    }
    else {
      var t = proj4.common.tsfnz(this.e, lat, Math.sin(lat));
      var ql = this.el / Math.pow(t, this.bl);
      var sl = 0.5 * (ql - 1 / ql);
      var tl = 0.5 * (ql + 1 / ql);
      var vl = Math.sin(this.bl * (dlon));
      var ul = (sl * Math.sin(this.gamma0) - vl * Math.cos(this.gamma0)) / tl;
      if (Math.abs(Math.abs(ul) - 1) <= proj4.common.EPSLN) {
        vs = Number.POSITIVE_INFINITY;
      }
      else {
        vs = 0.5 * this.al * Math.log((1 - ul) / (1 + ul)) / this.bl;
      }
      if (Math.abs(Math.cos(this.bl * (dlon))) <= proj4.common.EPSLN) {
        us = this.al * this.bl * (dlon);
      }
      else {
        us = this.al * Math.atan2(sl * Math.cos(this.gamma0) + vl * Math.sin(this.gamma0), Math.cos(this.bl * dlon)) / this.bl;
      }
    }

    if (this.no_rot) {
      p.x = this.x0 + us;
      p.y = this.y0 + vs;
    }
    else {

      us -= this.uc;
      p.x = this.x0 + vs * Math.cos(this.alpha) + us * Math.sin(this.alpha);
      p.y = this.y0 + us * Math.cos(this.alpha) - vs * Math.sin(this.alpha);
    }
    return p;
  },

  inverse: function(p) {
    var us, vs;
    if (this.no_rot) {
      vs = p.y - this.y0;
      us = p.x - this.x0;
    }
    else {
      vs = (p.x - this.x0) * Math.cos(this.alpha) - (p.y - this.y0) * Math.sin(this.alpha);
      us = (p.y - this.y0) * Math.cos(this.alpha) + (p.x - this.x0) * Math.sin(this.alpha);
      us += this.uc;
    }
    var qp = Math.exp(-1 * this.bl * vs / this.al);
    var sp = 0.5 * (qp - 1 / qp);
    var tp = 0.5 * (qp + 1 / qp);
    var vp = Math.sin(this.bl * us / this.al);
    var up = (vp * Math.cos(this.gamma0) + sp * Math.sin(this.gamma0)) / tp;
    var ts = Math.pow(this.el / Math.sqrt((1 + up) / (1 - up)), 1 / this.bl);
    if (Math.abs(up - 1) < proj4.common.EPSLN) {
      p.x = this.long0;
      p.y = proj4.common.HALF_PI;
    }
    else if (Math.abs(up + 1) < proj4.common.EPSLN) {
      p.x = this.long0;
      p.y = -1 * proj4.common.HALF_PI;
    }
    else {
      p.y = proj4.common.phi2z(this.e, ts);
      p.x = proj4.common.adjust_lon(this.long0 - Math.atan2(sp * Math.cos(this.gamma0) - vp * Math.sin(this.gamma0), Math.cos(this.bl * us / this.al)) / this.bl);
    }
    return p;
  }
};

/*******************************************************************************
NAME                             ORTHOGRAPHIC 

PURPOSE:  Transforms input longitude and latitude to Easting and
    Northing for the Orthographic projection.  The
    longitude and latitude must be in radians.  The Easting
    and Northing values will be returned in meters.

PROGRAMMER              DATE
----------              ----
T. Mittan    Mar, 1993

ALGORITHM REFERENCES

1.  Snyder, John P., "Map Projections--A Working Manual", U.S. Geological
    Survey Professional Paper 1395 (Supersedes USGS Bulletin 1532), United
    State Government Printing Office, Washington D.C., 1987.

2.  Snyder, John P. and Voxland, Philip M., "An Album of Map Projections",
    U.S. Geological Survey Professional Paper 1453 , United State Government
    Printing Office, Washington D.C., 1989.
*******************************************************************************/

proj4.Proj.ortho = {

  /* Initialize the Orthographic projection
    -------------------------------------*/
  init: function() {
    //double temp;      /* temporary variable    */

    /* Place parameters in static storage for common use
      -------------------------------------------------*/
    this.sin_p14 = Math.sin(this.lat0);
    this.cos_p14 = Math.cos(this.lat0);
  },


  /* Orthographic forward equations--mapping lat,long to x,y
    ---------------------------------------------------*/
  forward: function(p) {
    var sinphi, cosphi; /* sin and cos value        */
    var dlon; /* delta longitude value      */
    var coslon; /* cos of longitude        */
    var ksp; /* scale factor          */
    var g,x,y;
    var lon = p.x;
    var lat = p.y;
    /* Forward equations
      -----------------*/
    dlon = proj4.common.adjust_lon(lon - this.long0);

    sinphi = Math.sin(lat);
    cosphi = Math.cos(lat);

    coslon = Math.cos(dlon);
    g = this.sin_p14 * sinphi + this.cos_p14 * cosphi * coslon;
    ksp = 1;
    if ((g > 0) || (Math.abs(g) <= proj4.common.EPSLN)) {
      x = this.a * ksp * cosphi * Math.sin(dlon);
      y = this.y0 + this.a * ksp * (this.cos_p14 * sinphi - this.sin_p14 * cosphi * coslon);
    }
    else {
      proj4.reportError("orthoFwdPointError");
    }
    p.x = x;
    p.y = y;
    return p;
  },


  inverse: function(p) {
    var rh; /* height above ellipsoid      */
    var z; /* angle          */
    var sinz, cosz; /* sin of z and cos of z      */
    var con;
    var lon, lat;
    /* Inverse equations
      -----------------*/
    p.x -= this.x0;
    p.y -= this.y0;
    rh = Math.sqrt(p.x * p.x + p.y * p.y);
    if (rh > this.a + 0.0000001) {
      proj4.reportError("orthoInvDataError");
    }
    z = proj4.common.asinz(rh / this.a);

    sinz = Math.sin(z);
    cosz = Math.cos(z);

    lon = this.long0;
    if (Math.abs(rh) <= proj4.common.EPSLN) {
      lat = this.lat0;
      p.x = lon;
      p.y = lat;
      return p;
    }
    lat = proj4.common.asinz(cosz * this.sin_p14 + (p.y * sinz * this.cos_p14) / rh);
    con = Math.abs(this.lat0) - proj4.common.HALF_PI;
    if (Math.abs(con) <= proj4.common.EPSLN) {
      if (this.lat0 >= 0) {
        lon = proj4.common.adjust_lon(this.long0 + Math.atan2(p.x, - p.y));
      }
      else {
        lon = proj4.common.adjust_lon(this.long0 - Math.atan2(-p.x, p.y));
      }
      p.x = lon;
      p.y = lat;
      return p;
    }
    lon = proj4.common.adjust_lon(this.long0 + Math.atan2((p.x * sinz), rh * this.cos_p14 * cosz - p.y * this.sin_p14 * sinz));
    p.x = lon;
    p.y = lat;
    return p;
  }
};

/* Function to compute, phi4, the latitude for the inverse of the
   Polyconic projection.
------------------------------------------------------------*/
/*
function phi4z (eccent,e0,e1,e2,e3,a,b,c,phi) {
  var sinphi, sin2ph, tanphi, ml, mlp, con1, con2, con3, dphi, i;

  phi = a;
  for (i = 1; i <= 15; i++) {
    sinphi = Math.sin(phi);
    tanphi = Math.tan(phi);
    c = tanphi * Math.sqrt (1 - eccent * sinphi * sinphi);
    sin2ph = Math.sin (2 * phi);
    /*
    ml = e0 * *phi - e1 * sin2ph + e2 * sin (4 *  *phi);
    mlp = e0 - 2 * e1 * cos (2 *  *phi) + 4 * e2 *  cos (4 *  *phi);
    */
/*
    ml = e0 * phi - e1 * sin2ph + e2 * Math.sin (4 *  phi) - e3 * Math.sin (6 * phi);
    mlp = e0 - 2 * e1 * Math.cos (2 *  phi) + 4 * e2 * Math.cos (4 *  phi) - 6 * e3 * Math.cos (6 *  phi);
    con1 = 2 * ml + c * (ml * ml + b) - 2 * a *  (c * ml + 1);
    con2 = eccent * sin2ph * (ml * ml + b - 2 * a * ml) / (2 *c);
    con3 = 2 * (a - ml) * (c * mlp - 2 / sin2ph) - 2 * mlp;
    dphi = con1 / (con2 + con3);
    phi += dphi;
    if (Math.abs(dphi) <= .0000000001 ) return(phi);   
  }
  proj4.reportError("phi4z: No convergence");
  return null;
}
/*


/* Function to compute the constant e4 from the input of the eccentricity
   of the spheroid, x.  This constant is used in the Polar Stereographic
   projection.
--------------------------------------------------------------------*/
/*function e4fn(x) {
  var con, com;
  con = 1 + x;
  com = 1 - x;
  return (Math.sqrt((Math.pow(con, con)) * (Math.pow(com, com))));
}

*/



/*******************************************************************************
NAME                             POLYCONIC 

PURPOSE:  Transforms input longitude and latitude to Easting and
    Northing for the Polyconic projection.  The
    longitude and latitude must be in radians.  The Easting
    and Northing values will be returned in meters.

PROGRAMMER              DATE
----------              ----
T. Mittan    Mar, 1993

ALGORITHM REFERENCES

1.  Snyder, John P., "Map Projections--A Working Manual", U.S. Geological
    Survey Professional Paper 1395 (Supersedes USGS Bulletin 1532), United
    State Government Printing Office, Washington D.C., 1987.

2.  Snyder, John P. and Voxland, Philip M., "An Album of Map Projections",
    U.S. Geological Survey Professional Paper 1453 , United State Government
    Printing Office, Washington D.C., 1989.
*******************************************************************************/

proj4.Proj.poly = {

  /* Initialize the POLYCONIC projection
    ----------------------------------*/
  init: function() {
    /* Place parameters in static storage for common use
      -------------------------------------------------*/
    this.temp = this.b / this.a;
    this.es = 1 - Math.pow(this.temp, 2); // devait etre dans tmerc.js mais n y est pas donc je commente sinon retour de valeurs nulles
    this.e = Math.sqrt(this.es);
    this.e0 = proj4.common.e0fn(this.es);
    this.e1 = proj4.common.e1fn(this.es);
    this.e2 = proj4.common.e2fn(this.es);
    this.e3 = proj4.common.e3fn(this.es);
    this.ml0 = this.a * proj4.common.mlfn(this.e0, this.e1, this.e2, this.e3, this.lat0); //si que des zeros le calcul ne se fait pas
  },


  /* Polyconic forward equations--mapping lat,long to x,y
    ---------------------------------------------------*/
  forward: function(p) {
    var lon = p.x;
    var lat = p.y;
    var x, y, el;
    var dlon = proj4.common.adjust_lon(lon - this.long0);
    el = dlon * Math.sin(lat);
    if (this.sphere) {
      if (Math.abs(lat) <= proj4.common.EPSLN) {
        x = this.a * dlon;
        y = -1 * this.a * this.lat0;
      }
      else {
        x = this.a * Math.sin(el) / Math.tan(lat);
        y = this.a * (proj4.common.adjust_lat(lat - this.lat0) + (1 - Math.cos(el)) / Math.tan(lat));
      }
    }
    else {
      if (Math.abs(lat) <= proj4.common.EPSLN) {
        x = this.a * dlon;
        y = -1 * this.ml0;
      }
      else {
        var nl = proj4.common.gN(this.a, this.e, Math.sin(lat)) / Math.tan(lat);
        x = nl * Math.sin(el);
        y = this.a * proj4.common.mlfn(this.e0, this.e1, this.e2, this.e3, lat) - this.ml0 + nl * (1 - Math.cos(el));
      }

    }
    p.x = x + this.x0;
    p.y = y + this.y0;
    return p;
  },


  /* Inverse equations
  -----------------*/
  inverse: function(p) {
    var lon, lat, x, y, i;
    var al, bl;
    var phi, dphi;
    x = p.x - this.x0;
    y = p.y - this.y0;

    if (this.sphere) {
      if (Math.abs(y + this.a * this.lat0) <= proj4.common.EPSLN) {
        lon = proj4.common.adjust_lon(x / this.a + this.long0);
        lat = 0;
      }
      else {
        al = this.lat0 + y / this.a;
        bl = x * x / this.a / this.a + al * al;
        phi = al;
        var tanphi;
        for (i = proj4.common.MAX_ITER; i; --i) {
          tanphi = Math.tan(phi);
          dphi = -1 * (al * (phi * tanphi + 1) - phi - 0.5 * (phi * phi + bl) * tanphi) / ((phi - al) / tanphi - 1);
          phi += dphi;
          if (Math.abs(dphi) <= proj4.common.EPSLN) {
            lat = phi;
            break;
          }
        }
        lon = proj4.common.adjust_lon(this.long0 + (Math.asin(x * Math.tan(phi) / this.a)) / Math.sin(lat));
      }
    }
    else {
      if (Math.abs(y + this.ml0) <= proj4.common.EPSLN) {
        lat = 0;
        lon = proj4.common.adjust_lon(this.long0 + x / this.a);
      }
      else {

        al = (this.ml0 + y) / this.a;
        bl = x * x / this.a / this.a + al * al;
        phi = al;
        var cl, mln, mlnp, ma;
        var con;
        for (i = proj4.common.MAX_ITER; i; --i) {
          con = this.e * Math.sin(phi);
          cl = Math.sqrt(1 - con * con) * Math.tan(phi);
          mln = this.a * proj4.common.mlfn(this.e0, this.e1, this.e2, this.e3, phi);
          mlnp = this.e0 - 2 * this.e1 * Math.cos(2 * phi) + 4 * this.e2 * Math.cos(4 * phi) - 6 * this.e3 * Math.cos(6 * phi);
          ma = mln / this.a;
          dphi = (al * (cl * ma + 1) - ma - 0.5 * cl * (ma * ma + bl)) / (this.es * Math.sin(2 * phi) * (ma * ma + bl - 2 * al * ma) / (4 * cl) + (al - ma) * (cl * mlnp - 2 / Math.sin(2 * phi)) - mlnp);
          phi -= dphi;
          if (Math.abs(dphi) <= proj4.common.EPSLN) {
            lat = phi;
            break;
          }
        }

        //lat=phi4z(this.e,this.e0,this.e1,this.e2,this.e3,al,bl,0,0);
        cl = Math.sqrt(1 - this.es * Math.pow(Math.sin(lat), 2)) * Math.tan(lat);
        lon = proj4.common.adjust_lon(this.long0 + Math.asin(x * cl / this.a) / Math.sin(lat));
      }
    }

    p.x = lon;
    p.y = lat;
    return p;
  }
};

/*******************************************************************************
NAME                      SINUSOIDAL

PURPOSE:  Transforms input longitude and latitude to Easting and
    Northing for the Sinusoidal projection.  The
    longitude and latitude must be in radians.  The Easting
    and Northing values will be returned in meters.

PROGRAMMER              DATE            
----------              ----           
D. Steinwand, EROS      May, 1991     

This function was adapted from the Sinusoidal projection code (FORTRAN) in the 
General Cartographic Transformation Package software which is available from 
the U.S. Geological Survey National Mapping Division.
 
ALGORITHM REFERENCES

1.  Snyder, John P., "Map Projections--A Working Manual", U.S. Geological
    Survey Professional Paper 1395 (Supersedes USGS Bulletin 1532), United
    State Government Printing Office, Washington D.C., 1987.

2.  "Software Documentation for GCTP General Cartographic Transformation
    Package", U.S. Geological Survey National Mapping Division, May 1982.
*******************************************************************************/

proj4.Proj.sinu = {

  /* Initialize the Sinusoidal projection
    ------------------------------------*/
  init: function() {
    /* Place parameters in static storage for common use
    -------------------------------------------------*/


    if (!this.sphere) {
      this.en = proj4.common.pj_enfn(this.es);
    }
    else {
      this.n = 1;
      this.m = 0;
      this.es = 0;
      this.C_y = Math.sqrt((this.m + 1) / this.n);
      this.C_x = this.C_y / (this.m + 1);
    }

  },

  /* Sinusoidal forward equations--mapping lat,long to x,y
  -----------------------------------------------------*/
  forward: function(p) {
    var x, y;
    var lon = p.x;
    var lat = p.y;
    /* Forward equations
    -----------------*/
    lon = proj4.common.adjust_lon(lon - this.long0);

    if (this.sphere) {
      if (!this.m) {
        lat = this.n !== 1 ? Math.asin(this.n * Math.sin(lat)) : lat;
      }
      else {
        var k = this.n * Math.sin(lat);
        for (var i = proj4.common.MAX_ITER; i; --i) {
          var V = (this.m * lat + Math.sin(lat) - k) / (this.m + Math.cos(lat));
          lat -= V;
          if (Math.abs(V) < proj4.common.EPSLN){
            break;
          }
        }
      }
      x = this.a * this.C_x * lon * (this.m + Math.cos(lat));
      y = this.a * this.C_y * lat;

    }
    else {

      var s = Math.sin(lat);
      var c = Math.cos(lat);
      y = this.a * proj4.common.pj_mlfn(lat, s, c, this.en);
      x = this.a * lon * c / Math.sqrt(1 - this.es * s * s);
    }

    p.x = x;
    p.y = y;
    return p;
  },

  inverse: function(p) {
    var lat, temp, lon;

    /* Inverse equations
    -----------------*/
    p.x -= this.x0;
    p.y -= this.y0;
    lat = p.y / this.a;

    if (this.sphere) {

      p.y /= this.C_y;
      lat = this.m ? Math.asin((this.m * p.y + Math.sin(p.y)) / this.n) : (this.n !== 1 ? Math.asin(Math.sin(p.y) / this.n) : p.y);
      lon = p.x / (this.C_x * (this.m + Math.cos(p.y)));

    }
    else {
      lat = proj4.common.pj_inv_mlfn(p.y / this.a, this.es, this.en);
      var s = Math.abs(lat);
      if (s < proj4.common.HALF_PI) {
        s = Math.sin(lat);
        temp = this.long0 + p.x * Math.sqrt(1 - this.es * s * s) / (this.a * Math.cos(lat));
        //temp = this.long0 + p.x / (this.a * Math.cos(lat));
        lon = proj4.common.adjust_lon(temp);
      }
      else if ((s - proj4.common.EPSLN) < proj4.common.HALF_PI) {
        lon = this.long0;
      }

    }

    p.x = lon;
    p.y = lat;
    return p;
  }
};

/*******************************************************************************
NAME                       SWISS OBLIQUE MERCATOR

PURPOSE:  Swiss projection.
WARNING:  X and Y are inverted (weird) in the swiss coordinate system. Not
   here, since we want X to be horizontal and Y vertical.

ALGORITHM REFERENCES
1. "Formules et constantes pour le Calcul pour la
 projection cylindrique conforme à axe oblique et pour la transformation entre
 des systèmes de référence".
 http://www.swisstopo.admin.ch/internet/swisstopo/fr/home/topics/survey/sys/refsys/switzerland.parsysrelated1.31216.downloadList.77004.DownloadFile.tmp/swissprojectionfr.pdf

*******************************************************************************/

proj4.Proj.somerc = {

  init: function() {
    var phy0 = this.lat0;
    this.lambda0 = this.long0;
    var sinPhy0 = Math.sin(phy0);
    var semiMajorAxis = this.a;
    var invF = this.rf;
    var flattening = 1 / invF;
    var e2 = 2 * flattening - Math.pow(flattening, 2);
    var e = this.e = Math.sqrt(e2);
    this.R = this.k0 * semiMajorAxis * Math.sqrt(1 - e2) / (1 - e2 * Math.pow(sinPhy0, 2));
    this.alpha = Math.sqrt(1 + e2 / (1 - e2) * Math.pow(Math.cos(phy0), 4));
    this.b0 = Math.asin(sinPhy0 / this.alpha);
    var k1 = Math.log(Math.tan(Math.PI / 4 + this.b0 / 2));
    var k2 = Math.log(Math.tan(Math.PI / 4 + phy0 / 2));
    var k3 = Math.log((1 + e * sinPhy0) / (1 - e * sinPhy0));
    this.K = k1 - this.alpha * k2 + this.alpha * e / 2 * k3;
  },


  forward: function(p) {
    var Sa1 = Math.log(Math.tan(Math.PI / 4 - p.y / 2));
    var Sa2 = this.e / 2 * Math.log((1 + this.e * Math.sin(p.y)) / (1 - this.e * Math.sin(p.y)));
    var S = -this.alpha * (Sa1 + Sa2) + this.K;

    // spheric latitude
    var b = 2 * (Math.atan(Math.exp(S)) - Math.PI / 4);

    // spheric longitude
    var I = this.alpha * (p.x - this.lambda0);

    // psoeudo equatorial rotation
    var rotI = Math.atan(Math.sin(I) / (Math.sin(this.b0) * Math.tan(b) + Math.cos(this.b0) * Math.cos(I)));

    var rotB = Math.asin(Math.cos(this.b0) * Math.sin(b) - Math.sin(this.b0) * Math.cos(b) * Math.cos(I));

    p.y = this.R / 2 * Math.log((1 + Math.sin(rotB)) / (1 - Math.sin(rotB))) + this.y0;
    p.x = this.R * rotI + this.x0;
    return p;
  },

  inverse: function(p) {
    var Y = p.x - this.x0;
    var X = p.y - this.y0;

    var rotI = Y / this.R;
    var rotB = 2 * (Math.atan(Math.exp(X / this.R)) - Math.PI / 4);

    var b = Math.asin(Math.cos(this.b0) * Math.sin(rotB) + Math.sin(this.b0) * Math.cos(rotB) * Math.cos(rotI));
    var I = Math.atan(Math.sin(rotI) / (Math.cos(this.b0) * Math.cos(rotI) - Math.sin(this.b0) * Math.tan(rotB)));

    var lambda = this.lambda0 + I / this.alpha;

    var S = 0;
    var phy = b;
    var prevPhy = -1000;
    var iteration = 0;
    while (Math.abs(phy - prevPhy) > 0.0000001) {
      if (++iteration > 20) {
        proj4.reportError("omercFwdInfinity");
        return;
      }
      //S = Math.log(Math.tan(Math.PI / 4 + phy / 2));
      S = 1 / this.alpha * (Math.log(Math.tan(Math.PI / 4 + b / 2)) - this.K) + this.e * Math.log(Math.tan(Math.PI / 4 + Math.asin(this.e * Math.sin(phy)) / 2));
      prevPhy = phy;
      phy = 2 * Math.atan(Math.exp(S)) - Math.PI / 2;
    }

    p.x = lambda;
    p.y = phy;
    return p;
  }
};

// Initialize the Stereographic projection

proj4.Proj.stere = {
  ssfn_: function(phit, sinphi, eccen) {
    sinphi *= eccen;
    return (Math.tan(0.5 * (proj4.common.HALF_PI + phit)) * Math.pow((1 - sinphi) / (1 + sinphi), 0.5 * eccen));
  },

  init: function() {
    this.coslat0 = Math.cos(this.lat0);
    this.sinlat0 = Math.sin(this.lat0);
    if (this.sphere) {
      if (this.k0 === 1 && !isNaN(this.lat_ts) && Math.abs(this.coslat0) <= proj4.common.EPSLN) {
        this.k0 = 0.5 * (1 + proj4.common.sign(this.lat0) * Math.sin(this.lat_ts));
      }
    }
    else {
      if (Math.abs(this.coslat0) <= proj4.common.EPSLN) {
        if (this.lat0 > 0) {
          //North pole
          //trace('stere:north pole');
          this.con = 1;
        }
        else {
          //South pole
          //trace('stere:south pole');
          this.con = -1;
        }
      }
      this.cons = Math.sqrt(Math.pow(1 + this.e, 1 + this.e) * Math.pow(1 - this.e, 1 - this.e));
      if (this.k0 === 1 && !isNaN(this.lat_ts) && Math.abs(this.coslat0) <= proj4.common.EPSLN) {
        this.k0 = 0.5 * this.cons * proj4.common.msfnz(this.e, Math.sin(this.lat_ts), Math.cos(this.lat_ts)) / proj4.common.tsfnz(this.e, this.con * this.lat_ts, this.con * Math.sin(this.lat_ts));
      }
      this.ms1 = proj4.common.msfnz(this.e, this.sinlat0, this.coslat0);
      this.X0 = 2 * Math.atan(this.ssfn_(this.lat0, this.sinlat0, this.e)) - proj4.common.HALF_PI;
      this.cosX0 = Math.cos(this.X0);
      this.sinX0 = Math.sin(this.X0);
    }
  },

  // Stereographic forward equations--mapping lat,long to x,y
  forward: function(p) {
    var lon = p.x;
    var lat = p.y;
    var sinlat = Math.sin(lat);
    var coslat = Math.cos(lat);
    var A, X, sinX, cosX, ts, rh;
    var dlon = proj4.common.adjust_lon(lon - this.long0);

    if (Math.abs(Math.abs(lon - this.long0) - proj4.common.PI) <= proj4.common.EPSLN && Math.abs(lat + this.lat0) <= proj4.common.EPSLN) {
      //case of the origine point
      //trace('stere:this is the origin point');
      p.x = NaN;
      p.y = NaN;
      return p;
    }
    if (this.sphere) {
      //trace('stere:sphere case');
      A = 2 * this.k0 / (1 + this.sinlat0 * sinlat + this.coslat0 * coslat * Math.cos(dlon));
      p.x = this.a * A * coslat * Math.sin(dlon) + this.x0;
      p.y = this.a * A * (this.coslat0 * sinlat - this.sinlat0 * coslat * Math.cos(dlon)) + this.y0;
      return p;
    }
    else {
      X = 2 * Math.atan(this.ssfn_(lat, sinlat, this.e)) - proj4.common.HALF_PI;
      cosX = Math.cos(X);
      sinX = Math.sin(X);
      if (Math.abs(this.coslat0) <= proj4.common.EPSLN) {
        ts = proj4.common.tsfnz(this.e, lat * this.con, this.con * sinlat);
        rh = 2 * this.a * this.k0 * ts / this.cons;
        p.x = this.x0 + rh * Math.sin(lon - this.long0);
        p.y = this.y0 - this.con * rh * Math.cos(lon - this.long0);
        //trace(p.toString());
        return p;
      }
      else if (Math.abs(this.sinlat0) < proj4.common.EPSLN) {
        //Eq
        //trace('stere:equateur');
        A = 2 * this.a * this.k0 / (1 + cosX * Math.cos(dlon));
        p.y = A * sinX;
      }
      else {
        //other case
        //trace('stere:normal case');
        A = 2 * this.a * this.k0 * this.ms1 / (this.cosX0 * (1 + this.sinX0 * sinX + this.cosX0 * cosX * Math.cos(dlon)));
        p.y = A * (this.cosX0 * sinX - this.sinX0 * cosX * Math.cos(dlon)) + this.y0;
      }
      p.x = A * cosX * Math.sin(dlon) + this.x0;
    }
    //trace(p.toString());
    return p;
  },


  //* Stereographic inverse equations--mapping x,y to lat/long
  inverse: function(p) {
    p.x -= this.x0;
    p.y -= this.y0;
    var lon, lat, ts, ce, Chi;
    var rh = Math.sqrt(p.x * p.x + p.y * p.y);
    if (this.sphere) {
      var c = 2 * Math.atan(rh / (0.5 * this.a * this.k0));
      lon = this.long0;
      lat = this.lat0;
      if (rh <= proj4.common.EPSLN) {
        p.x = lon;
        p.y = lat;
        return p;
      }
      lat = Math.asin(Math.cos(c) * this.sinlat0 + p.y * Math.sin(c) * this.coslat0 / rh);
      if (Math.abs(this.coslat0) < proj4.common.EPSLN) {
        if (this.lat0 > 0) {
          lon = proj4.common.adjust_lon(this.long0 + Math.atan2(p.x, - 1 * p.y));
        }
        else {
          lon = proj4.common.adjust_lon(this.long0 + Math.atan2(p.x, p.y));
        }
      }
      else {
        lon = proj4.common.adjust_lon(this.long0 + Math.atan2(p.x * Math.sin(c), rh * this.coslat0 * Math.cos(c) - p.y * this.sinlat0 * Math.sin(c)));
      }
      p.x = lon;
      p.y = lat;
      return p;
    }
    else {
      if (Math.abs(this.coslat0) <= proj4.common.EPSLN) {
        if (rh <= proj4.common.EPSLN) {
          lat = this.lat0;
          lon = this.long0;
          p.x = lon;
          p.y = lat;
          //trace(p.toString());
          return p;
        }
        p.x *= this.con;
        p.y *= this.con;
        ts = rh * this.cons / (2 * this.a * this.k0);
        lat = this.con * proj4.common.phi2z(this.e, ts);
        lon = this.con * proj4.common.adjust_lon(this.con * this.long0 + Math.atan2(p.x, - 1 * p.y));
      }
      else {
        ce = 2 * Math.atan(rh * this.cosX0 / (2 * this.a * this.k0 * this.ms1));
        lon = this.long0;
        if (rh <= proj4.common.EPSLN) {
          Chi = this.X0;
        }
        else {
          Chi = Math.asin(Math.cos(ce) * this.sinX0 + p.y * Math.sin(ce) * this.cosX0 / rh);
          lon = proj4.common.adjust_lon(this.long0 + Math.atan2(p.x * Math.sin(ce), rh * this.cosX0 * Math.cos(ce) - p.y * this.sinX0 * Math.sin(ce)));
        }
        lat = -1 * proj4.common.phi2z(this.e, Math.tan(0.5 * (proj4.common.HALF_PI + Chi)));
      }
    }
    p.x = lon;
    p.y = lat;

    //trace(p.toString());
    return p;

  }
};


proj4.Proj.sterea = {
  dependsOn : 'gauss',

  init : function() {
    proj4.Proj.gauss.init.apply(this);
    if (!this.rc) {
      proj4.reportError("sterea:init:E_ERROR_0");
      return;
    }
    this.sinc0 = Math.sin(this.phic0);
    this.cosc0 = Math.cos(this.phic0);
    this.R2 = 2 * this.rc;
    if (!this.title){
      this.title = "Oblique Stereographic Alternative";
    }
  },

  forward : function(p) {
    var sinc, cosc, cosl, k;
    p.x = proj4.common.adjust_lon(p.x-this.long0); /* adjust del longitude */
    proj4.Proj.gauss.forward.apply(this, [p]);
    sinc = Math.sin(p.y);
    cosc = Math.cos(p.y);
    cosl = Math.cos(p.x);
    k = this.k0 * this.R2 / (1 + this.sinc0 * sinc + this.cosc0 * cosc * cosl);
    p.x = k * cosc * Math.sin(p.x);
    p.y = k * (this.cosc0 * sinc - this.sinc0 * cosc * cosl);
    p.x = this.a * p.x + this.x0;
    p.y = this.a * p.y + this.y0;
    return p;
  },

  inverse : function(p) {
    var sinc, cosc, lon, lat, rho;
    p.x = (p.x - this.x0) / this.a; /* descale and de-offset */
    p.y = (p.y - this.y0) / this.a;

    p.x /= this.k0;
    p.y /= this.k0;
    if ( (rho = Math.sqrt(p.x*p.x + p.y*p.y)) ) {
      var c = 2 * Math.atan2(rho, this.R2);
      sinc = Math.sin(c);
      cosc = Math.cos(c);
      lat = Math.asin(cosc * this.sinc0 + p.y * sinc * this.cosc0 / rho);
      lon = Math.atan2(p.x * sinc, rho * this.cosc0 * cosc - p.y * this.sinc0 * sinc);
    } else {
      lat = this.phic0;
      lon = 0;
    }

    p.x = lon;
    p.y = lat;
    proj4.Proj.gauss.inverse.apply(this,[p]);
    p.x = proj4.common.adjust_lon(p.x + this.long0); /* adjust longitude to CM */
    return p;
  }
};


/*******************************************************************************
NAME                            TRANSVERSE MERCATOR

PURPOSE:  Transforms input longitude and latitude to Easting and
    Northing for the Transverse Mercator projection.  The
    longitude and latitude must be in radians.  The Easting
    and Northing values will be returned in meters.

ALGORITHM REFERENCES

1.  Snyder, John P., "Map Projections--A Working Manual", U.S. Geological
    Survey Professional Paper 1395 (Supersedes USGS Bulletin 1532), United
    State Government Printing Office, Washington D.C., 1987.

2.  Snyder, John P. and Voxland, Philip M., "An Album of Map Projections",
    U.S. Geological Survey Professional Paper 1453 , United State Government
    Printing Office, Washington D.C., 1989.
*******************************************************************************/


/**
  Initialize Transverse Mercator projection
*/

proj4.Proj.tmerc = {
  init : function() {
    this.e0 = proj4.common.e0fn(this.es);
    this.e1 = proj4.common.e1fn(this.es);
    this.e2 = proj4.common.e2fn(this.es);
    this.e3 = proj4.common.e3fn(this.es);
    this.ml0 = this.a * proj4.common.mlfn(this.e0, this.e1, this.e2, this.e3, this.lat0);
  },

  /**
    Transverse Mercator Forward  - long/lat to x/y
    long/lat in radians
  */
  forward : function(p) {
    var lon = p.x;
    var lat = p.y;

    var delta_lon = proj4.common.adjust_lon(lon - this.long0); // Delta longitude
    var con;    // cone constant
    var x, y;
    var sin_phi=Math.sin(lat);
    var cos_phi=Math.cos(lat);

    if (this.sphere) {  /* spherical form */
      var b = cos_phi * Math.sin(delta_lon);
      if ((Math.abs(Math.abs(b) - 1)) < 0.0000000001)  {
        proj4.reportError("tmerc:forward: Point projects into infinity");
        return(93);
      } else {
        x = 0.5 * this.a * this.k0 * Math.log((1 + b)/(1 - b));
        con = Math.acos(cos_phi * Math.cos(delta_lon)/Math.sqrt(1 - b*b));
        if (lat < 0) {
          con = - con;
        }
        y = this.a * this.k0 * (con - this.lat0);
      }
    } else {
      var al  = cos_phi * delta_lon;
      var als = Math.pow(al,2);
      var c   = this.ep2 * Math.pow(cos_phi,2);
      var tq  = Math.tan(lat);
      var t   = Math.pow(tq,2);
      con = 1 - this.es * Math.pow(sin_phi,2);
      var n   = this.a / Math.sqrt(con);
      var ml  = this.a * proj4.common.mlfn(this.e0, this.e1, this.e2, this.e3, lat);

      x = this.k0 * n * al * (1 + als / 6 * (1 - t + c + als / 20 * (5 - 18 * t + Math.pow(t,2) + 72 * c - 58 * this.ep2))) + this.x0;
      y = this.k0 * (ml - this.ml0 + n * tq * (als * (0.5 + als / 24 * (5 - t + 9 * c + 4 * Math.pow(c,2) + als / 30 * (61 - 58 * t + Math.pow(t,2) + 600 * c - 330 * this.ep2))))) + this.y0;

    }
    p.x = x;
    p.y = y;
    return p;
  }, // tmercFwd()

  /**
    Transverse Mercator Inverse  -  x/y to long/lat
  */
  inverse : function(p) {
    var con, phi;  /* temporary angles       */
    var delta_phi; /* difference between longitudes    */
    var i;
    var max_iter = 6;      /* maximun number of iterations */
    var lat, lon;

    if (this.sphere) {   /* spherical form */
      var f = Math.exp(p.x/(this.a * this.k0));
      var g = 0.5 * (f - 1/f);
      var temp = this.lat0 + p.y/(this.a * this.k0);
      var h = Math.cos(temp);
      con = Math.sqrt((1 - h * h)/(1 + g * g));
      lat = proj4.common.asinz(con);
      if (temp < 0) {
        lat = -lat;
      }
      if ((g === 0) && (h === 0)) {
        lon = this.long0;
      } else {
        lon = proj4.common.adjust_lon(Math.atan2(g,h) + this.long0);
      }
    } else { // ellipsoidal form
      var x = p.x - this.x0;
      var y = p.y - this.y0;

      con = (this.ml0 + y / this.k0) / this.a;
      phi = con;
      for (i=0;true;i++) {
        delta_phi=((con + this.e1 * Math.sin(2*phi) - this.e2 * Math.sin(4*phi) + this.e3 * Math.sin(6*phi)) / this.e0) - phi;
        phi += delta_phi;
        if (Math.abs(delta_phi) <= proj4.common.EPSLN){
          break;
        }
        if (i >= max_iter) {
          proj4.reportError("tmerc:inverse: Latitude failed to converge");
          return(95);
        }
      } // for()
      if (Math.abs(phi) < proj4.common.HALF_PI) {
        // sincos(phi, &sin_phi, &cos_phi);
        var sin_phi=Math.sin(phi);
        var cos_phi=Math.cos(phi);
        var tan_phi = Math.tan(phi);
        var c = this.ep2 * Math.pow(cos_phi,2);
        var cs = Math.pow(c,2);
        var t = Math.pow(tan_phi,2);
        var ts = Math.pow(t,2);
        con = 1 - this.es * Math.pow(sin_phi,2);
        var n = this.a / Math.sqrt(con);
        var r = n * (1 - this.es) / con;
        var d = x / (n * this.k0);
        var ds = Math.pow(d,2);
        lat = phi - (n * tan_phi * ds / r) * (0.5 - ds / 24 * (5 + 3 * t + 10 * c - 4 * cs - 9 * this.ep2 - ds / 30 * (61 + 90 * t + 298 * c + 45 * ts - 252 * this.ep2 - 3 * cs)));
        lon = proj4.common.adjust_lon(this.long0 + (d * (1 - ds / 6 * (1 + 2 * t + c - ds / 20 * (5 - 2 * c + 28 * t - 3 * cs + 8 * this.ep2 + 24 * ts))) / cos_phi));
      } else {
        lat = proj4.common.HALF_PI * proj4.common.sign(y);
        lon = this.long0;
      }
    }
    p.x = lon;
    p.y = lat;
    return p;
  } // tmercInv()
};
/*******************************************************************************
NAME                            TRANSVERSE MERCATOR

PURPOSE:  Transforms input longitude and latitude to Easting and
    Northing for the Transverse Mercator projection.  The
    longitude and latitude must be in radians.  The Easting
    and Northing values will be returned in meters.

ALGORITHM REFERENCES

1.  Snyder, John P., "Map Projections--A Working Manual", U.S. Geological
    Survey Professional Paper 1395 (Supersedes USGS Bulletin 1532), United
    State Government Printing Office, Washington D.C., 1987.

2.  Snyder, John P. and Voxland, Philip M., "An Album of Map Projections",
    U.S. Geological Survey Professional Paper 1453 , United State Government
    Printing Office, Washington D.C., 1989.
*******************************************************************************/


/**
  Initialize Transverse Mercator projection
*/

proj4.Proj.utm = {
  dependsOn : 'tmerc',

  init : function() {
    if (!this.zone) {
      proj4.reportError("utm:init: zone must be specified for UTM");
      return;
    }
    this.lat0 = 0;
    this.long0 = ((6 * Math.abs(this.zone)) - 183) * proj4.common.D2R;
    this.x0 = 500000;
    this.y0 = this.utmSouth ? 10000000 : 0;
    this.k0 = 0.9996;

    proj4.Proj.tmerc.init.apply(this);
    this.forward = proj4.Proj.tmerc.forward;
    this.inverse = proj4.Proj.tmerc.inverse;
  }
};
/*******************************************************************************
NAME                    VAN DER GRINTEN 

PURPOSE:  Transforms input Easting and Northing to longitude and
    latitude for the Van der Grinten projection.  The
    Easting and Northing must be in meters.  The longitude
    and latitude values will be returned in radians.

PROGRAMMER              DATE            
----------              ----           
T. Mittan    March, 1993

This function was adapted from the Van Der Grinten projection code
(FORTRAN) in the General Cartographic Transformation Package software
which is available from the U.S. Geological Survey National Mapping Division.
 
ALGORITHM REFERENCES

1.  "New Equal-Area Map Projections for Noncircular Regions", John P. Snyder,
    The American Cartographer, Vol 15, No. 4, October 1988, pp. 341-355.

2.  Snyder, John P., "Map Projections--A Working Manual", U.S. Geological
    Survey Professional Paper 1395 (Supersedes USGS Bulletin 1532), United
    State Government Printing Office, Washington D.C., 1987.

3.  "Software Documentation for GCTP General Cartographic Transformation
    Package", U.S. Geological Survey National Mapping Division, May 1982.
*******************************************************************************/

proj4.Proj.vandg = {

/* Initialize the Van Der Grinten projection
  ----------------------------------------*/
  init: function() {
    //this.R = 6370997; //Radius of earth
    this.R = this.a;
  },

  forward: function(p) {

    var lon=p.x;
    var lat=p.y;

    /* Forward equations
    -----------------*/
    var dlon = proj4.common.adjust_lon(lon - this.long0);
    var x,y;

    if (Math.abs(lat) <= proj4.common.EPSLN) {
      x = this.x0  + this.R * dlon;
      y = this.y0;
    }
    var theta = proj4.common.asinz(2 * Math.abs(lat / proj4.common.PI));
    if ((Math.abs(dlon) <= proj4.common.EPSLN) || (Math.abs(Math.abs(lat) - proj4.common.HALF_PI) <= proj4.common.EPSLN)) {
      x = this.x0;
      if (lat >= 0) {
        y = this.y0 + proj4.common.PI * this.R * Math.tan(0.5 * theta);
      } else {
        y = this.y0 + proj4.common.PI * this.R * - Math.tan(0.5 * theta);
      }
      //  return(OK);
    }
    var al = 0.5 * Math.abs((proj4.common.PI / dlon) - (dlon / proj4.common.PI));
    var asq = al * al;
    var sinth = Math.sin(theta);
    var costh = Math.cos(theta);

    var g = costh / (sinth + costh - 1);
    var gsq = g * g;
    var m = g * (2 / sinth - 1);
    var msq = m * m;
    var con = proj4.common.PI * this.R * (al * (g - msq) + Math.sqrt(asq * (g - msq) * (g - msq) - (msq + asq) * (gsq - msq))) / (msq + asq);
    if (dlon < 0) {
      con = -con;
    }
    x = this.x0 + con;
    //con = Math.abs(con / (proj4.common.PI * this.R));
    var q =asq+g;
    con=proj4.common.PI*this.R*(m*q-al*Math.sqrt((msq+asq)*(asq+1)-q*q))/(msq+asq);
    if (lat >= 0) {
      //y = this.y0 + proj4.common.PI * this.R * Math.sqrt(1 - con * con - 2 * al * con);
      y=this.y0 + con;
    } else {
      //y = this.y0 - proj4.common.PI * this.R * Math.sqrt(1 - con * con - 2 * al * con);
      y=this.y0 - con;
    }
    p.x = x;
    p.y = y;
    return p;
  },

/* Van Der Grinten inverse equations--mapping x,y to lat/long
  ---------------------------------------------------------*/
  inverse: function(p) {
    var lon, lat;
    var xx,yy,xys,c1,c2,c3;
    var a1;
    var m1;
    var con;
    var th1;
    var d;

    /* inverse equations
    -----------------*/
    p.x -= this.x0;
    p.y -= this.y0;
    con = proj4.common.PI * this.R;
    xx = p.x / con;
    yy =p.y / con;
    xys = xx * xx + yy * yy;
    c1 = -Math.abs(yy) * (1 + xys);
    c2 = c1 - 2 * yy * yy + xx * xx;
    c3 = -2 * c1 + 1 + 2 * yy * yy + xys * xys;
    d = yy * yy / c3 + (2 * c2 * c2 * c2 / c3 / c3 / c3 - 9 * c1 * c2 / c3 /c3) / 27;
    a1 = (c1 - c2 * c2 / 3 / c3) / c3;
    m1 = 2 * Math.sqrt( -a1 / 3);
    con = ((3 * d) / a1) / m1;
    if (Math.abs(con) > 1) {
      if (con >= 0) {
        con = 1;
      } else {
        con = -1;
      }
    }
    th1 = Math.acos(con) / 3;
    if (p.y >= 0) {
      lat = (-m1 *Math.cos(th1 + proj4.common.PI / 3) - c2 / 3 / c3) * proj4.common.PI;
    } else {
      lat = -(-m1 * Math.cos(th1 + proj4.common.PI / 3) - c2 / 3 / c3) * proj4.common.PI;
    }

    if (Math.abs(xx) < proj4.common.EPSLN) {
      lon = this.long0;
    } else {
      lon = proj4.common.adjust_lon(this.long0 + proj4.common.PI * (xys - 1 + Math.sqrt(1 + 2 * (xx * xx - yy * yy) + xys * xys)) / 2 / xx);
    }

    p.x=lon;
    p.y=lat;
    return p;
  }
};

/*jshint browser: true, node: true*/
/*
Portions of this software are based on a port of components from the OpenMap
com.bbn.openmap.proj.coords Java package. An initial port was initially created
by Patrice G. Cappelaere and included in Community Mapbuilder
(http://svn.codehaus.org/mapbuilder/), which is licensed under the LGPL license
as per http://www.gnu.org/copyleft/lesser.html. OpenMap is licensed under the
following license agreement:


               OpenMap Software License Agreement
               ----------------------------------

This Agreement sets forth the terms and conditions under which
the software known as OpenMap(tm) will be licensed by BBN
Technologies ("BBN") to you ("Licensee"), and by which Derivative 
Works (as hereafter defined) of OpenMap will be licensed by you to BBN.

Definitions:

 "Derivative Work(s)" shall mean any revision, enhancement,
 modification, translation, abridgement, condensation or
 expansion created by Licensee or BBN that is based upon the
 Software or a portion thereof that would be a copyright
 infringement if prepared without the authorization of the
 copyright owners of the Software or portion thereof.

 "OpenMap" shall mean a programmer's toolkit for building map
 based applications as originally created by BBN, and any
 Derivative Works thereof as created by either BBN or Licensee,
 but shall include only those Derivative Works BBN has approved
 for inclusion into, and BBN has integrated into OpenMap.

 "Standard Version" shall mean OpenMap, as originally created by
 BBN.

 "Software" shall mean OpenMap and the Derivative Works created
 by Licensee and the collection of files distributed by the
 Licensee with OpenMap, and the collection of files created
 through textual modifications.

 "Copyright Holder" is whoever is named in the copyright or
 copyrights for the Derivative Works.

 "Licensee" is you, only if you agree to be bound by the terms
 and conditions set forth in this Agreement.

 "Reasonable copying fee" is whatever you can justify on the
 basis of media cost, duplication charges, time of people
 involved.

 "Freely Available" means that no fee is charged for the item
 itself, though there may be fees involved in handling the item.
 It also means that recipients of the item may redistribute it
 under the same conditions that they received it.

1. BBN maintains all rights, title and interest in and to
OpenMap, including all applicable copyrights, trade secrets,
patents and other intellectual rights therein.  Licensee hereby
grants to BBN all right, title and interest into the compilation
of OpenMap.  Licensee shall own all rights, title and interest
into the Derivative Works created by Licensee (subject to the
compilation ownership by BBN).

2. BBN hereby grants to Licensee a royalty free, worldwide right
and license to use, copy, distribute and make Derivative Works of
OpenMap, and sublicensing rights of any of the foregoing in
accordance with the terms and conditions of this Agreement,
provided that you duplicate all of the original copyright notices
and associated disclaimers.

3. Licensee hereby grants to BBN a royalty free, worldwide right
and license to use, copy, distribute and make Derivative Works of
Derivative Works created by Licensee and sublicensing rights of
any of the foregoing.

4. Licensee's right to create Derivative Works in the Software is
subject to Licensee agreement to insert a prominent notice in
each changed file stating how and when you changed that file, and
provided that you do at least ONE of the following:

    a) place your modifications in the Public Domain or otherwise
       make them Freely Available, such as by posting said
       modifications to Usenet or an equivalent medium, or
       placing the modifications on a major archive site and by
       providing your modifications to the Copyright Holder.

    b) use the modified Package only within your corporation or
       organization.

    c) rename any non-standard executables so the names do not
       conflict with standard executables, which must also be
       provided, and provide a separate manual page for each
       non-standard executable that clearly documents how it
       differs from OpenMap.

    d) make other distribution arrangements with the Copyright
       Holder.

5. Licensee may distribute the programs of this Software in
object code or executable form, provided that you do at least ONE
of the following:

    a) distribute an OpenMap version of the executables and
       library files, together with instructions (in the manual
       page or equivalent) on where to get OpenMap.

    b) accompany the distribution with the machine-readable
       source code with your modifications.

    c) accompany any non-standard executables with their
       corresponding OpenMap executables, giving the non-standard
       executables non-standard names, and clearly documenting
       the differences in manual pages (or equivalent), together
       with instructions on where to get OpenMap.

    d) make other distribution arrangements with the Copyright
       Holder.

6. You may charge a reasonable copying fee for any distribution
of this Software.  You may charge any fee you choose for support
of this Software.  You may not charge a fee for this Software
itself.  However, you may distribute this Software in aggregate
with other (possibly commercial) programs as part of a larger
(possibly commercial) software distribution provided that you do
not advertise this Software as a product of your own.

7. The data and images supplied as input to or produced as output
from the Software do not automatically fall under the copyright
of this Software, but belong to whomever generated them, and may
be sold commercially, and may be aggregated with this Software.

8. BBN makes no representation about the suitability of OpenMap
for any purposes.  BBN shall have no duty or requirement to
include any Derivative Works into OpenMap.

9. Each party hereto represents and warrants that they have the
full unrestricted right to grant all rights and licenses granted
to the other party herein.

10. THIS PACKAGE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY
KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING (BUT NOT LIMITED TO)
ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS, AND
WITHOUT ANY WARRANTIES AS TO NONINFRINGEMENT.

11. IN NO EVENT SHALL COPYRIGHT HOLDER BE LIABLE FOR ANY DIRECT,
SPECIAL, INDIRECT OR CONSEQUENTIAL DAMAGES WHATSOEVER RESULTING
FROM LOSS OF USE OF DATA OR PROFITS, WHETHER IN AN ACTION OF
CONTRACT, NEGLIGENCE OR OTHER TORTIOUS CONDUCT, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS PACKAGE.

12. Without limitation of the foregoing, You agree to commit no
act which, directly or indirectly, would violate any U.S. law,
regulation, or treaty, or any other international treaty or
agreement to which the United States adheres or with which the
United States complies, relating to the export or re-export of
any commodities, software, or technical data.
*/

if (typeof proj4 !== 'undefined' && !proj4.util) {
  proj4.util = {};
}

/**
 * Converts between lat/lon and MGRS coordinates. Note that this static class
 * is restricted to the WGS84 ellipsoid and does not support MGRS notations
 * for polar regions (i.e. above 84° North and below 80° South).
 *
 * If proj4 is loaded, this will be referenced as proj4.util.MGRS. If used
 * standalone, it will be referenced as window.MGRS.
 *
 * @static
 */
(function() {

  /**
   * UTM zones are grouped, and assigned to one of a group of 6
   * sets.
   *
   * {int} @private
   */
  var NUM_100K_SETS = 6;

  /**
   * The column letters (for easting) of the lower left value, per
   * set.
   *
   * {string} @private
   */
  var SET_ORIGIN_COLUMN_LETTERS = 'AJSAJS';

  /**
   * The row letters (for northing) of the lower left value, per
   * set.
   *
   * {string} @private
   */
  var SET_ORIGIN_ROW_LETTERS = 'AFAFAF';

  var A = 65; // A
  var I = 73; // I
  var O = 79; // O
  var V = 86; // V
  var Z = 90; // Z

  /**
   * Conversion of lat/lon to MGRS.
   *
   * @param {object} ll Object literal with lat and lon properties on a
   *     WGS84 ellipsoid.
   * @param {int} accuracy Accuracy in digits (5 for 1 m, 4 for 10 m, 3 for
   *      100 m, 4 for 1000 m or 5 for 10000 m). Optional, default is 5.
   * @return {string} the MGRS string for the given location and accuracy.
   */
  function forward(ll, accuracy) {
    accuracy = accuracy || 5; // default accuracy 1m
    return encode(LLtoUTM({
      lat: ll.lat,
      lon: ll.lon
    }), accuracy);
  }

  /**
   * Conversion of MGRS to lat/lon.
   *
   * @param {string} mgrs MGRS string.
   * @return {array} An array with left (longitude), bottom (latitude), right
   *     (longitude) and top (latitude) values in WGS84, representing the
   *     bounding box for the provided MGRS reference.
   */
  function inverse(mgrs) {
    var bbox = UTMtoLL(decode(mgrs.toUpperCase()));
    return [bbox.left, bbox.bottom, bbox.right, bbox.top];
  }

  /**
   * Conversion from degrees to radians.
   *
   * @private
   * @param {number} deg the angle in degrees.
   * @return {number} the angle in radians.
   */
  function degToRad(deg) {
    return (deg * (Math.PI / 180.0));
  }

  /**
   * Conversion from radians to degrees.
   *
   * @private
   * @param {number} rad the angle in radians.
   * @return {number} the angle in degrees.
   */
  function radToDeg(rad) {
    return (180.0 * (rad / Math.PI));
  }

  /**
   * Converts a set of Longitude and Latitude co-ordinates to UTM
   * using the WGS84 ellipsoid.
   *
   * @private
   * @param {object} ll Object literal with lat and lon properties
   *     representing the WGS84 coordinate to be converted.
   * @return {object} Object literal containing the UTM value with easting,
   *     northing, zoneNumber and zoneLetter properties, and an optional
   *     accuracy property in digits. Returns null if the conversion failed.
   */
  function LLtoUTM(ll) {
    var Lat = ll.lat;
    var Long = ll.lon;
    var a = 6378137.0; //ellip.radius;
    var eccSquared = 0.00669438; //ellip.eccsq;
    var k0 = 0.9996;
    var LongOrigin;
    var eccPrimeSquared;
    var N, T, C, A, M;
    var LatRad = degToRad(Lat);
    var LongRad = degToRad(Long);
    var LongOriginRad;
    var ZoneNumber;
    // (int)
    ZoneNumber = Math.floor((Long + 180) / 6) + 1;

    //Make sure the longitude 180.00 is in Zone 60
    if (Long === 180) {
      ZoneNumber = 60;
    }

    // Special zone for Norway
    if (Lat >= 56.0 && Lat < 64.0 && Long >= 3.0 && Long < 12.0) {
      ZoneNumber = 32;
    }

    // Special zones for Svalbard
    if (Lat >= 72.0 && Lat < 84.0) {
      if (Long >= 0.0 && Long < 9.0){
        ZoneNumber = 31;
      }
      else if (Long >= 9.0 && Long < 21.0){
        ZoneNumber = 33;
      }
      else if (Long >= 21.0 && Long < 33.0){
        ZoneNumber = 35;
      }
      else if (Long >= 33.0 && Long < 42.0){
        ZoneNumber = 37;
      }
    }

    LongOrigin = (ZoneNumber - 1) * 6 - 180 + 3; //+3 puts origin
    // in middle of
    // zone
    LongOriginRad = degToRad(LongOrigin);

    eccPrimeSquared = (eccSquared) / (1 - eccSquared);

    N = a / Math.sqrt(1 - eccSquared * Math.sin(LatRad) * Math.sin(LatRad));
    T = Math.tan(LatRad) * Math.tan(LatRad);
    C = eccPrimeSquared * Math.cos(LatRad) * Math.cos(LatRad);
    A = Math.cos(LatRad) * (LongRad - LongOriginRad);

    M = a * ((1 - eccSquared / 4 - 3 * eccSquared * eccSquared / 64 - 5 * eccSquared * eccSquared * eccSquared / 256) * LatRad - (3 * eccSquared / 8 + 3 * eccSquared * eccSquared / 32 + 45 * eccSquared * eccSquared * eccSquared / 1024) * Math.sin(2 * LatRad) + (15 * eccSquared * eccSquared / 256 + 45 * eccSquared * eccSquared * eccSquared / 1024) * Math.sin(4 * LatRad) - (35 * eccSquared * eccSquared * eccSquared / 3072) * Math.sin(6 * LatRad));

    var UTMEasting = (k0 * N * (A + (1 - T + C) * A * A * A / 6.0 + (5 - 18 * T + T * T + 72 * C - 58 * eccPrimeSquared) * A * A * A * A * A / 120.0) + 500000.0);

    var UTMNorthing = (k0 * (M + N * Math.tan(LatRad) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A * A * A * A / 24.0 + (61 - 58 * T + T * T + 600 * C - 330 * eccPrimeSquared) * A * A * A * A * A * A / 720.0)));
    if (Lat < 0.0) {
      UTMNorthing += 10000000.0; //10000000 meter offset for
      // southern hemisphere
    }

    return {
      northing: Math.round(UTMNorthing),
      easting: Math.round(UTMEasting),
      zoneNumber: ZoneNumber,
      zoneLetter: getLetterDesignator(Lat)
    };
  }

  /**
   * Converts UTM coords to lat/long, using the WGS84 ellipsoid. This is a convenience
   * class where the Zone can be specified as a single string eg."60N" which
   * is then broken down into the ZoneNumber and ZoneLetter.
   *
   * @private
   * @param {object} utm An object literal with northing, easting, zoneNumber
   *     and zoneLetter properties. If an optional accuracy property is
   *     provided (in meters), a bounding box will be returned instead of
   *     latitude and longitude.
   * @return {object} An object literal containing either lat and lon values
   *     (if no accuracy was provided), or top, right, bottom and left values
   *     for the bounding box calculated according to the provided accuracy.
   *     Returns null if the conversion failed.
   */
  function UTMtoLL(utm) {

    var UTMNorthing = utm.northing;
    var UTMEasting = utm.easting;
    var zoneLetter = utm.zoneLetter;
    var zoneNumber = utm.zoneNumber;
    // check the ZoneNummber is valid
    if (zoneNumber < 0 || zoneNumber > 60) {
      return null;
    }

    var k0 = 0.9996;
    var a = 6378137.0; //ellip.radius;
    var eccSquared = 0.00669438; //ellip.eccsq;
    var eccPrimeSquared;
    var e1 = (1 - Math.sqrt(1 - eccSquared)) / (1 + Math.sqrt(1 - eccSquared));
    var N1, T1, C1, R1, D, M;
    var LongOrigin;
    var mu, phi1Rad;

    // remove 500,000 meter offset for longitude
    var x = UTMEasting - 500000.0;
    var y = UTMNorthing;

    // We must know somehow if we are in the Northern or Southern
    // hemisphere, this is the only time we use the letter So even
    // if the Zone letter isn't exactly correct it should indicate
    // the hemisphere correctly
    if (zoneLetter < 'N') {
      y -= 10000000.0; // remove 10,000,000 meter offset used
      // for southern hemisphere
    }

    // There are 60 zones with zone 1 being at West -180 to -174
    LongOrigin = (zoneNumber - 1) * 6 - 180 + 3; // +3 puts origin
    // in middle of
    // zone

    eccPrimeSquared = (eccSquared) / (1 - eccSquared);

    M = y / k0;
    mu = M / (a * (1 - eccSquared / 4 - 3 * eccSquared * eccSquared / 64 - 5 * eccSquared * eccSquared * eccSquared / 256));

    phi1Rad = mu + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu) + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu);
    // double phi1 = ProjMath.radToDeg(phi1Rad);

    N1 = a / Math.sqrt(1 - eccSquared * Math.sin(phi1Rad) * Math.sin(phi1Rad));
    T1 = Math.tan(phi1Rad) * Math.tan(phi1Rad);
    C1 = eccPrimeSquared * Math.cos(phi1Rad) * Math.cos(phi1Rad);
    R1 = a * (1 - eccSquared) / Math.pow(1 - eccSquared * Math.sin(phi1Rad) * Math.sin(phi1Rad), 1.5);
    D = x / (N1 * k0);

    var lat = phi1Rad - (N1 * Math.tan(phi1Rad) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * eccPrimeSquared) * D * D * D * D / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * eccPrimeSquared - 3 * C1 * C1) * D * D * D * D * D * D / 720);
    lat = radToDeg(lat);

    var lon = (D - (1 + 2 * T1 + C1) * D * D * D / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * eccPrimeSquared + 24 * T1 * T1) * D * D * D * D * D / 120) / Math.cos(phi1Rad);
    lon = LongOrigin + radToDeg(lon);

    var result;
    if (utm.accuracy) {
      var topRight = UTMtoLL({
        northing: utm.northing + utm.accuracy,
        easting: utm.easting + utm.accuracy,
        zoneLetter: utm.zoneLetter,
        zoneNumber: utm.zoneNumber
      });
      result = {
        top: topRight.lat,
        right: topRight.lon,
        bottom: lat,
        left: lon
      };
    }
    else {
      result = {
        lat: lat,
        lon: lon
      };
    }
    return result;
  }

  /**
   * Calculates the MGRS letter designator for the given latitude.
   *
   * @private
   * @param {number} lat The latitude in WGS84 to get the letter designator
   *     for.
   * @return {char} The letter designator.
   */
  function getLetterDesignator(lat) {
    //This is here as an error flag to show that the Latitude is
    //outside MGRS limits
    var LetterDesignator = 'Z';

    if ((84 >= lat) && (lat >= 72)){
      LetterDesignator = 'X';
    } else if ((72 > lat) && (lat >= 64)){
      LetterDesignator = 'W';
    } else if ((64 > lat) && (lat >= 56)){
      LetterDesignator = 'V';
    } else if ((56 > lat) && (lat >= 48)){
      LetterDesignator = 'U';
    } else if ((48 > lat) && (lat >= 40)){
      LetterDesignator = 'T';
    } else if ((40 > lat) && (lat >= 32)){
      LetterDesignator = 'S';
    } else if ((32 > lat) && (lat >= 24)){
      LetterDesignator = 'R';
    } else if ((24 > lat) && (lat >= 16)){
      LetterDesignator = 'Q';
    } else if ((16 > lat) && (lat >= 8)){
      LetterDesignator = 'P';
    } else if ((8 > lat) && (lat >= 0)){
      LetterDesignator = 'N';
    } else if ((0 > lat) && (lat >= -8)){
      LetterDesignator = 'M';
    } else if ((-8 > lat) && (lat >= -16)){
      LetterDesignator = 'L';
    } else if ((-16 > lat) && (lat >= -24)){
      LetterDesignator = 'K';
    } else if ((-24 > lat) && (lat >= -32)){
      LetterDesignator = 'J';
    } else if ((-32 > lat) && (lat >= -40)){
      LetterDesignator = 'H';
    } else if ((-40 > lat) && (lat >= -48)){
      LetterDesignator = 'G';
    } else if ((-48 > lat) && (lat >= -56)){
      LetterDesignator = 'F';
    } else if ((-56 > lat) && (lat >= -64)){
      LetterDesignator = 'E';
    } else if ((-64 > lat) && (lat >= -72)){
      LetterDesignator = 'D';
    } else if ((-72 > lat) && (lat >= -80)){
      LetterDesignator = 'C';
    }
    return LetterDesignator;
  }

  /**
   * Encodes a UTM location as MGRS string.
   *
   * @private
   * @param {object} utm An object literal with easting, northing,
   *     zoneLetter, zoneNumber
   * @param {number} accuracy Accuracy in digits (1-5).
   * @return {string} MGRS string for the given UTM location.
   */
  function encode(utm, accuracy) {
    var seasting = "" + utm.easting,
      snorthing = "" + utm.northing;

    return utm.zoneNumber + utm.zoneLetter + get100kID(utm.easting, utm.northing, utm.zoneNumber) + seasting.substr(seasting.length - 5, accuracy) + snorthing.substr(snorthing.length - 5, accuracy);
  }

  /**
   * Get the two letter 100k designator for a given UTM easting,
   * northing and zone number value.
   *
   * @private
   * @param {number} easting
   * @param {number} northing
   * @param {number} zoneNumber
   * @return the two letter 100k designator for the given UTM location.
   */
  function get100kID(easting, northing, zoneNumber) {
    var setParm = get100kSetForZone(zoneNumber);
    var setColumn = Math.floor(easting / 100000);
    var setRow = Math.floor(northing / 100000) % 20;
    return getLetter100kID(setColumn, setRow, setParm);
  }

  /**
   * Given a UTM zone number, figure out the MGRS 100K set it is in.
   *
   * @private
   * @param {number} i An UTM zone number.
   * @return {number} the 100k set the UTM zone is in.
   */
  function get100kSetForZone(i) {
    var setParm = i % NUM_100K_SETS;
    if (setParm === 0){
      setParm = NUM_100K_SETS;
    }

    return setParm;
  }

  /**
   * Get the two-letter MGRS 100k designator given information
   * translated from the UTM northing, easting and zone number.
   *
   * @private
   * @param {number} column the column index as it relates to the MGRS
   *        100k set spreadsheet, created from the UTM easting.
   *        Values are 1-8.
   * @param {number} row the row index as it relates to the MGRS 100k set
   *        spreadsheet, created from the UTM northing value. Values
   *        are from 0-19.
   * @param {number} parm the set block, as it relates to the MGRS 100k set
   *        spreadsheet, created from the UTM zone. Values are from
   *        1-60.
   * @return two letter MGRS 100k code.
   */
  function getLetter100kID(column, row, parm) {
    // colOrigin and rowOrigin are the letters at the origin of the set
    var index = parm - 1;
    var colOrigin = SET_ORIGIN_COLUMN_LETTERS.charCodeAt(index);
    var rowOrigin = SET_ORIGIN_ROW_LETTERS.charCodeAt(index);

    // colInt and rowInt are the letters to build to return
    var colInt = colOrigin + column - 1;
    var rowInt = rowOrigin + row;
    var rollover = false;

    if (colInt > Z) {
      colInt = colInt - Z + A - 1;
      rollover = true;
    }

    if (colInt === I || (colOrigin < I && colInt > I) || ((colInt > I || colOrigin < I) && rollover)) {
      colInt++;
    }

    if (colInt === O || (colOrigin < O && colInt > O) || ((colInt > O || colOrigin < O) && rollover)) {
      colInt++;

      if (colInt === I) {
        colInt++;
      }
    }

    if (colInt > Z) {
      colInt = colInt - Z + A - 1;
    }

    if (rowInt > V) {
      rowInt = rowInt - V + A - 1;
      rollover = true;
    }
    else {
      rollover = false;
    }

    if (((rowInt === I) || ((rowOrigin < I) && (rowInt > I))) || (((rowInt > I) || (rowOrigin < I)) && rollover)) {
      rowInt++;
    }

    if (((rowInt === O) || ((rowOrigin < O) && (rowInt > O))) || (((rowInt > O) || (rowOrigin < O)) && rollover)) {
      rowInt++;

      if (rowInt === I) {
        rowInt++;
      }
    }

    if (rowInt > V) {
      rowInt = rowInt - V + A - 1;
    }

    var twoLetter = String.fromCharCode(colInt) + String.fromCharCode(rowInt);
    return twoLetter;
  }

  /**
   * Decode the UTM parameters from a MGRS string.
   *
   * @private
   * @param {string} mgrsString an UPPERCASE coordinate string is expected.
   * @return {object} An object literal with easting, northing, zoneLetter,
   *     zoneNumber and accuracy (in meters) properties.
   */
  function decode(mgrsString) {

    if (mgrsString && mgrsString.length === 0) {
      throw ("MGRSPoint coverting from nothing");
    }

    var length = mgrsString.length;

    var hunK = null;
    var sb = "";
    var testChar;
    var i = 0;

    // get Zone number
    while (!(/[A-Z]/).test(testChar = mgrsString.charAt(i))) {
      if (i >= 2) {
        throw ("MGRSPoint bad conversion from: " + mgrsString);
      }
      sb += testChar;
      i++;
    }

    var zoneNumber = parseInt(sb, 10);

    if (i === 0 || i + 3 > length) {
      // A good MGRS string has to be 4-5 digits long,
      // ##AAA/#AAA at least.
      throw ("MGRSPoint bad conversion from: " + mgrsString);
    }

    var zoneLetter = mgrsString.charAt(i++);

    // Should we check the zone letter here? Why not.
    if (zoneLetter <= 'A' || zoneLetter === 'B' || zoneLetter === 'Y' || zoneLetter >= 'Z' || zoneLetter === 'I' || zoneLetter === 'O') {
      throw ("MGRSPoint zone letter " + zoneLetter + " not handled: " + mgrsString);
    }

    hunK = mgrsString.substring(i, i += 2);

    var set = get100kSetForZone(zoneNumber);

    var east100k = getEastingFromChar(hunK.charAt(0), set);
    var north100k = getNorthingFromChar(hunK.charAt(1), set);

    // We have a bug where the northing may be 2000000 too low.
    // How
    // do we know when to roll over?

    while (north100k < getMinNorthing(zoneLetter)) {
      north100k += 2000000;
    }

    // calculate the char index for easting/northing separator
    var remainder = length - i;

    if (remainder % 2 !== 0) {
      throw ("MGRSPoint has to have an even number \nof digits after the zone letter and two 100km letters - front \nhalf for easting meters, second half for \nnorthing meters" + mgrsString);
    }

    var sep = remainder / 2;

    var sepEasting = 0.0;
    var sepNorthing = 0.0;
    var accuracyBonus,sepEastingString,sepNorthingString,easting,northing;
    if (sep > 0) {
      accuracyBonus = 100000.0 / Math.pow(10, sep);
      sepEastingString = mgrsString.substring(i, i + sep);
      sepEasting = parseFloat(sepEastingString) * accuracyBonus;
      sepNorthingString = mgrsString.substring(i + sep);
      sepNorthing = parseFloat(sepNorthingString) * accuracyBonus;
    }

    easting = sepEasting + east100k;
    northing = sepNorthing + north100k;

    return {
      easting: easting,
      northing: northing,
      zoneLetter: zoneLetter,
      zoneNumber: zoneNumber,
      accuracy: accuracyBonus
    };
  }

  /**
   * Given the first letter from a two-letter MGRS 100k zone, and given the
   * MGRS table set for the zone number, figure out the easting value that
   * should be added to the other, secondary easting value.
   *
   * @private
   * @param {char} e The first letter from a two-letter MGRS 100´k zone.
   * @param {number} set The MGRS table set for the zone number.
   * @return {number} The easting value for the given letter and set.
   */
  function getEastingFromChar(e, set) {
    // colOrigin is the letter at the origin of the set for the
    // column
    var curCol = SET_ORIGIN_COLUMN_LETTERS.charCodeAt(set - 1);
    var eastingValue = 100000.0;
    var rewindMarker = false;

    while (curCol !== e.charCodeAt(0)) {
      curCol++;
      if (curCol === I){
        curCol++;
      }
      if (curCol === O){
        curCol++;
      }
      if (curCol > Z) {
        if (rewindMarker) {
          throw ("Bad character: " + e);
        }
        curCol = A;
        rewindMarker = true;
      }
      eastingValue += 100000.0;
    }

    return eastingValue;
  }

  /**
   * Given the second letter from a two-letter MGRS 100k zone, and given the
   * MGRS table set for the zone number, figure out the northing value that
   * should be added to the other, secondary northing value. You have to
   * remember that Northings are determined from the equator, and the vertical
   * cycle of letters mean a 2000000 additional northing meters. This happens
   * approx. every 18 degrees of latitude. This method does *NOT* count any
   * additional northings. You have to figure out how many 2000000 meters need
   * to be added for the zone letter of the MGRS coordinate.
   *
   * @private
   * @param {char} n Second letter of the MGRS 100k zone
   * @param {number} set The MGRS table set number, which is dependent on the
   *     UTM zone number.
   * @return {number} The northing value for the given letter and set.
   */
  function getNorthingFromChar(n, set) {

    if (n > 'V') {
      throw ("MGRSPoint given invalid Northing " + n);
    }

    // rowOrigin is the letter at the origin of the set for the
    // column
    var curRow = SET_ORIGIN_ROW_LETTERS.charCodeAt(set - 1);
    var northingValue = 0.0;
    var rewindMarker = false;

    while (curRow !== n.charCodeAt(0)) {
      curRow++;
      if (curRow === I){
        curRow++;
      }
      if (curRow === O){
        curRow++;
      }
      // fixing a bug making whole application hang in this loop
      // when 'n' is a wrong character
      if (curRow > V) {
        if (rewindMarker) { // making sure that this loop ends
          throw ("Bad character: " + n);
        }
        curRow = A;
        rewindMarker = true;
      }
      northingValue += 100000.0;
    }

    return northingValue;
  }

  /**
   * The function getMinNorthing returns the minimum northing value of a MGRS
   * zone.
   *
   * Ported from Geotrans' c Lattitude_Band_Value structure table.
   *
   * @private
   * @param {char} zoneLetter The MGRS zone to get the min northing for.
   * @return {number}
   */
  function getMinNorthing(zoneLetter) {
    var northing;
    switch (zoneLetter) {
    case 'C':
      northing = 1100000.0;
      break;
    case 'D':
      northing = 2000000.0;
      break;
    case 'E':
      northing = 2800000.0;
      break;
    case 'F':
      northing = 3700000.0;
      break;
    case 'G':
      northing = 4600000.0;
      break;
    case 'H':
      northing = 5500000.0;
      break;
    case 'J':
      northing = 6400000.0;
      break;
    case 'K':
      northing = 7300000.0;
      break;
    case 'L':
      northing = 8200000.0;
      break;
    case 'M':
      northing = 9100000.0;
      break;
    case 'N':
      northing = 0.0;
      break;
    case 'P':
      northing = 800000.0;
      break;
    case 'Q':
      northing = 1700000.0;
      break;
    case 'R':
      northing = 2600000.0;
      break;
    case 'S':
      northing = 3500000.0;
      break;
    case 'T':
      northing = 4400000.0;
      break;
    case 'U':
      northing = 5300000.0;
      break;
    case 'V':
      northing = 6200000.0;
      break;
    case 'W':
      northing = 7000000.0;
      break;
    case 'X':
      northing = 7900000.0;
      break;
    default:
      northing = -1.0;
    }
    if (northing >= 0.0) {
      return northing;
    }
    else {
      throw ("Invalid zone letter: " + zoneLetter);
    }

  }

  var MGRS = {
    forward: forward,
    inverse: inverse
  };
  if (typeof proj4 !== 'undefined') {
    proj4.util.MGRS = MGRS;
  }
  else if (typeof window !== 'undefined') {
    window.MGRS = MGRS;
  }
  else if (typeof module !== 'undefined') {
    module.exports = MGRS;
  }

})();

if (typeof proj4 !== 'undefined' && proj4.Point) {

  /**
   * Creates a proj4.Point instance from a MGRS reference. The point will
   * reference the center of the MGRS reference, and coordinates will be in
   * WGS84 longitude and latitude.
   *
   * Only available if proj4 is loaded.
   *
   * @param mgrs {string} MGRS reference
   */
  proj4.Point.fromMGRS = function(mgrs) {
    var llbbox = proj4.util.MGRS.inverse(mgrs);
    return new proj4.Point(
    (llbbox[2] + llbbox[0]) / 2, (llbbox[3] + llbbox[1]) / 2);
  };

  /**
   * Converts a proj4.Point instance to a MGRS reference. The point
   * coordinates are expected to be in WGS84 longitude and latitude.
   *
   * Only available if proj4 is loaded.
   *
   * @param accuracy {int} The accuracy for the MGRS reference in digits (5
   *     for 1 m, 4 for 10 m, 3 for 100 m, 4 for 1000 m or 5 for 10000 m) 
   */
  proj4.Point.prototype.toMGRS = function(accuracy) {
    return proj4.util.MGRS.forward({
      lon: this.x,
      lat: this.y
    }, accuracy);
  };

}